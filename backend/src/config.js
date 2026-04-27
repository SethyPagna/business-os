'use strict'
/**
 * config.js — Centralised runtime configuration.
 *
 * DATA FOLDER RESOLUTION ORDER (first match wins):
 *   1. data-location.json beside the exe / project root  — user chose a custom path
 *   2. business-os-data/ beside the exe / project root   — default portable folder
 *   3. Explicit DB_PATH / UPLOADS_PATH in .env           — legacy override
 *
 * The data folder is always named "business-os-data" and sits in the same
 * directory as the application (or wherever the user points it).
 */

const path = require('path')
const fs   = require('fs')
const Database = require('better-sqlite3')

// ── Runtime base directory ────────────────────────────────────────────────────
const IS_PKG      = typeof process.pkg !== 'undefined'
const RUNTIME_DIR = process.env.BUSINESS_OS_RUNTIME_DIR && process.env.BUSINESS_OS_RUNTIME_DIR.trim()
  ? path.resolve(process.env.BUSINESS_OS_RUNTIME_DIR.trim())
  : IS_PKG
    ? path.dirname(process.execPath)
    : path.resolve(__dirname, '../..')   // backend/src -> backend -> project root

// ── Load .env ─────────────────────────────────────────────────────────────────
const ENV_CANDIDATES = [
  process.env.DOTENV_PATH || '',
  path.join(__dirname, '../.env'),
  path.join(RUNTIME_DIR, '.env'),
].filter(Boolean)
for (const envPath of ENV_CANDIDATES) {
  if (fs.existsSync(envPath)) { require('dotenv').config({ path: envPath }); break }
}

// ── Data location file ────────────────────────────────────────────────────────
// data-location.json stores { "dataDir": "C:\\some\\custom\\path" }
// Written by the frontend Settings page when the user picks a new folder.
const DATA_LOCATION_FILE = path.join(RUNTIME_DIR, 'data-location.json')
const DATA_FOLDER_NAME = 'business-os-data'
const DEFAULT_STORAGE_ROOT = path.join(RUNTIME_DIR, DATA_FOLDER_NAME)
const DEFAULT_ORGANIZATION_BOOTSTRAP = {
  name: 'LeangCosmetics',
  slug: 'leangcosmetics',
  publicId: 'org_leangcosmetics',
}

function isDefaultDataMarker(value) {
  const marker = String(value || '').trim().toLowerCase()
  return marker === '__default__' || marker === 'default'
}

function resolveStoredDataDir(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value || isDefaultDataMarker(value)) return null
  if (path.isAbsolute(value)) return path.normalize(value)
  return path.resolve(RUNTIME_DIR, value)
}

function normalizeSelectedDataDir(rawValue) {
  const value = String(rawValue || '').trim()
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
    if (fs.existsSync(DATA_LOCATION_FILE)) {
      const raw = fs.readFileSync(DATA_LOCATION_FILE, 'utf8')
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') {
        const candidate = resolveStoredDataDir(obj.dataDir)
        if (candidate) return candidate
      }
    }
  } catch (_) {}
  return null
}

function writeDataLocation(newDir) {
  const raw = String(newDir || '').trim()
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

function readPrimaryOrganizationPublicId(dbPath) {
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
      SELECT public_id
      FROM organizations
      WHERE public_id IS NOT NULL AND trim(public_id) != ''
      ORDER BY id ASC
      LIMIT 1
    `).get()
    return String(row?.public_id || '').trim() || null
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

function isOrganizationRuntimeRoot(root) {
  const resolved = path.resolve(String(root || ''))
  return path.basename(path.dirname(resolved)).toLowerCase() === 'organizations'
}

function ensureOrganizationRuntimeLayout(runtimeRoot) {
  ;['db', 'uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta'].forEach((folder) => {
    ensureDirectory(path.join(runtimeRoot, folder))
  })
}

function migrateLegacySharedRootToOrganization(storageRoot, organizationPublicId) {
  const sourceRoot = path.resolve(storageRoot)
  const targetRoot = path.join(sourceRoot, 'organizations', organizationPublicId)
  const targetDbPath = path.join(targetRoot, 'db', 'business.db')
  const sourceDbPath = path.join(sourceRoot, 'db', 'business.db')

  ensureOrganizationRuntimeLayout(targetRoot)
  if (!pathExists(sourceDbPath) || pathExists(targetDbPath)) return targetRoot

  const copyEntries = ['db', 'uploads', 'imports', 'exports', 'backups', 'logs', 'tmp', 'users', 'meta']
  for (const name of copyEntries) {
    const sourcePath = path.join(sourceRoot, name)
    const targetPath = path.join(targetRoot, name)
    copyTree(sourcePath, targetPath)
  }

  const markerPath = path.join(targetRoot, 'meta', 'bootstrap-migration.json')
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      migratedAt: new Date().toISOString(),
      sourceRoot,
      targetRoot,
      note: 'Legacy shared runtime data was copied into the organization runtime root. The source folder was left untouched for safety.',
    }, null, 2), 'utf8')
  } catch (_) {}

  return targetRoot
}

function detectExistingOrganizationRuntimeRoot(storageRoot) {
  const organizationsRoot = path.join(storageRoot, 'organizations')
  if (!pathExists(organizationsRoot)) return null
  const candidates = fs.readdirSync(organizationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(organizationsRoot, entry.name))
    .filter((candidate) => pathExists(path.join(candidate, 'db', 'business.db')))
  return candidates[0] || null
}

// ── Resolve storage root ──────────────────────────────────────────────────────
//   Priority: data-location.json -> env override -> default business-os-data
const STORAGE_ROOT = (function () {
  const located = readDataLocation()
  if (located) return located

  // Legacy: explicit env var (keeps backward compat with any existing .env)
  if (process.env.DATA_ROOT && process.env.DATA_ROOT.trim())
    return path.resolve(process.env.DATA_ROOT.trim())

  // Default: business-os-data/ beside the application
  return DEFAULT_STORAGE_ROOT
})()

const ORGANIZATION_PUBLIC_ID = (function () {
  if (isOrganizationRuntimeRoot(STORAGE_ROOT)) {
    return path.basename(path.resolve(STORAGE_ROOT)) || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId
  }

  const legacyDbPath = path.join(STORAGE_ROOT, 'db', 'business.db')
  return readPrimaryOrganizationPublicId(legacyDbPath)
    || path.basename(detectExistingOrganizationRuntimeRoot(STORAGE_ROOT) || '')
    || DEFAULT_ORGANIZATION_BOOTSTRAP.publicId
})()

const DATA_ROOT = (function () {
  if (isOrganizationRuntimeRoot(STORAGE_ROOT)) {
    ensureOrganizationRuntimeLayout(STORAGE_ROOT)
    return STORAGE_ROOT
  }

  const targetRoot = migrateLegacySharedRootToOrganization(STORAGE_ROOT, ORGANIZATION_PUBLIC_ID)
  ensureOrganizationRuntimeLayout(targetRoot)
  return targetRoot
})()

// ── Derived paths ─────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH && process.env.DB_PATH.trim()
  ? path.resolve(process.env.DB_PATH.trim())
  : path.join(DATA_ROOT, 'db', 'business.db')

const UPLOADS_PATH = process.env.UPLOADS_PATH && process.env.UPLOADS_PATH.trim()
  ? path.resolve(process.env.UPLOADS_PATH.trim())
  : path.join(DATA_ROOT, 'uploads')

const EXTERNAL_FRONTEND_DIST = path.join(RUNTIME_DIR, 'frontend', 'dist')
const EMBEDDED_FRONTEND_DIST = path.resolve(__dirname, '../frontend-dist')
const FRONTEND_DIST = fs.existsSync(EXTERNAL_FRONTEND_DIST)
  ? EXTERNAL_FRONTEND_DIST
  : EMBEDDED_FRONTEND_DIST

// ── Exported constants ────────────────────────────────────────────────────────
const PORT         = parseInt(process.env.PORT || '4000', 10)
const SYNC_TOKEN   = (process.env.SYNC_TOKEN   || '').trim()
const TAILSCALE_URL = (process.env.TAILSCALE_URL || '').trim()

// ── Startup diagnostics ───────────────────────────────────────────────────────
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
  STORAGE_ROOT,
  DATA_ROOT,
  DEFAULT_STORAGE_ROOT,
  DATA_FOLDER_NAME,
  DEFAULT_ORGANIZATION_BOOTSTRAP,
  ORGANIZATION_PUBLIC_ID,
  PORT,
  SYNC_TOKEN,
  TAILSCALE_URL,
  DB_PATH,
  UPLOADS_PATH,
  FRONTEND_DIST,
  DATA_LOCATION_FILE,
  normalizeSelectedDataDir,
  readDataLocation,
  writeDataLocation,
}
