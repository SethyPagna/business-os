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
const DEFAULT_DATA_ROOT = path.join(RUNTIME_DIR, DATA_FOLDER_NAME)

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

// ── Resolve data root ─────────────────────────────────────────────────────────
//   Priority: data-location.json -> env override -> default business-os-data
const DATA_ROOT = (function () {
  const located = readDataLocation()
  if (located) return located

  // Legacy: explicit env var (keeps backward compat with any existing .env)
  if (process.env.DATA_ROOT && process.env.DATA_ROOT.trim())
    return path.resolve(process.env.DATA_ROOT.trim())

  // Default: business-os-data/ beside the application
  return DEFAULT_DATA_ROOT
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
  console.log(`[config] DATA_ROOT    : ${DATA_ROOT}`)
  console.log(`[config] DB_PATH      : ${DB_PATH}`)
  console.log(`[config] UPLOADS_PATH : ${UPLOADS_PATH}`)
  console.log(`[config] FRONTEND_DIST: ${FRONTEND_DIST}`)
}

module.exports = {
  IS_PKG,
  RUNTIME_DIR,
  DATA_ROOT,
  DEFAULT_DATA_ROOT,
  DATA_FOLDER_NAME,
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
