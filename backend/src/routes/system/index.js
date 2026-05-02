'use strict'
/**
 * system.js
 * Operational/system endpoints:
 * - backup export/import
 * - reset/factory-reset
 * - integrity verify/repair
 * - runtime data-path management
 * - lightweight diagnostics
 *
 * This module touches many tables; changes here require careful FK-safe ordering.
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const Database = require('better-sqlite3')
const express = require('express')
const { db, ensureCoreDataInvariants } = require('../../database')
const {
  UPLOADS_PATH,
  DB_PATH,
  IMPORTS_PATH,
  RUNTIME_DIR,
  STORAGE_ROOT,
  DATA_ROOT,
  DEFAULT_STORAGE_ROOT,
  DATA_FOLDER_NAME,
  DATA_LOCATION_FILE,
  writeDataLocation,
  normalizeSelectedDataDir,
  PUBLIC_BASE_URL,
  CLOUDFLARE_PUBLIC_URL,
  CLOUDFLARE_ADMIN_URL,
  GOOGLE_DRIVE_OAUTH_REDIRECT_URI,
  BUSINESS_OS_REQUIRE_SCALE_SERVICES,
  JOB_QUEUE_DRIVER,
  REDIS_URL,
  CACHE_REDIS_URL,
  RUNTIME_CACHE_ENABLED,
  DATABASE_DRIVER,
  DATABASE_URL,
  OBJECT_STORAGE_DRIVER,
  S3_ENDPOINT,
  S3_BUCKET,
} = require('../../config')
const {
  summarizeDataRoot,
  isSamePath,
  isSubPath,
} = require('../../dataPath')
const {
  BACKUP_VERSION,
  BACKUP_TABLES,
  BACKUP_CLEAR_ORDER,
  buildBackupSummary,
} = require('../../backupSchema')
const { ok, err, audit, broadcast, today, getServerLog, wss_clients, runDataIntegrityCheck } = require('../../helpers')
const { authToken, requirePermission, requireAnyPermission, getAuditActor } = require('../../middleware')
const { checkRateLimit } = require('../../security')
const { classifyRequestAccess } = require('../../accessControl')
const { getDefaultOrganization, ensureOrganizationFilesystemLayout, getOrganizationStorageStatus } = require('../../organizationContext')
const {
  GOOGLE_DRIVE_SCOPE,
  beginGoogleDriveOAuth,
  disconnectDriveSync,
  finalizeGoogleDriveOAuth,
  getDriveSyncConfig,
  getDriveSyncStatus,
  runDriveSync,
  saveDriveSyncPreferences,
  forgetDriveSyncCredentials,
} = require('../../services/googleDriveSync')
const { cancelAllImportJobs, deleteAllImportJobs, getQueueStatus, initializeBullQueue } = require('../../services/importJobs')
const { buildRuntimeDescriptor, bumpStorageVersion } = require('../../runtimeState')
const { startSystemJob, getSystemJob, listSystemJobs } = require('../../systemJobs')

const router = express.Router()
const SYSTEM_FS_WORKER = path.join(__dirname, '../../systemFsWorker.js')

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function getClientKey(req, suffix = '') {
  const xForwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = xForwardedFor || req.ip || req.connection?.remoteAddress || 'unknown-ip'
  return `${ip}|${String(suffix || '').trim().toLowerCase()}`
}

function applyRouteRateLimit(req, res, options = {}) {
  const name = String(options.name || 'system:route')
  const max = Math.max(1, Number(options.max || 30))
  const windowMs = Math.max(1_000, Number(options.windowMs || 60 * 1000))
  const key = getClientKey(req, options.key || name)
  const result = checkRateLimit(name, key, max, windowMs)
  if (result.allowed) return true
  res.setHeader('Retry-After', String(result.retryAfterSeconds))
  err(res, `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`, 429)
  return false
}

async function stopImportsBeforeDestructiveAction(actionLabel) {
  const summary = await cancelAllImportJobs({
    reason: `${actionLabel} stopped this import before changing business data.`,
    waitMs: 20_000,
  })
  if (summary.remaining?.length) {
    const ids = summary.remaining.map((job) => job.id).join(', ')
    const error = new Error(`Background imports are still stopping (${ids}). Try again after the top import tracker shows cancelled.`)
    error.code = 'background_imports_still_stopping'
    error.summary = summary
    throw error
  }
  return summary
}

function runFsWorker(action, payload, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SYSTEM_FS_WORKER, action, JSON.stringify(payload || {})], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null

    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill() } catch (_) {}
        finish(new Error('The filesystem job took too long and was cancelled.'))
      }, timeoutMs)
    }

    child.stdout.on('data', (chunk) => { stdout += String(chunk || '') })
    child.stderr.on('data', (chunk) => { stderr += String(chunk || '') })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      const raw = stdout.trim()
      if (code !== 0) {
        let message = stderr.trim() || raw || `Worker exited with code ${code}`
        try {
          const parsed = raw ? JSON.parse(raw) : null
          if (parsed?.error) message = parsed.error
        } catch (_) {}
        finish(new Error(message))
        return
      }

      try {
        const parsed = JSON.parse(raw || '{}')
        if (!parsed?.ok) {
          finish(new Error(parsed?.error || 'Worker failed'))
          return
        }
        finish(null, parsed.result)
      } catch (error) {
        finish(new Error(`Worker returned invalid output: ${error.message}`))
      }
    })
  })
}

function getHostUiAvailability(req) {
  const access = classifyRequestAccess(req)
  const authenticatedSession = !!req?.user?.id
  return {
    access,
    hostUiAvailable: process.platform === 'win32' && (authenticatedSession || !!access.localRequest),
  }
}

function buildRequestBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http'
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  if (!host) return ''
  return `${proto}://${host}`
}

function resolveDriveRedirectUri(req) {
  const configured = String(GOOGLE_DRIVE_OAUTH_REDIRECT_URI || '').trim()
  if (configured) return configured
  const baseUrl = String(PUBLIC_BASE_URL || '').trim() || buildRequestBaseUrl(req)
  return baseUrl ? `${baseUrl}/api/system/drive-sync/oauth/callback` : ''
}

function getTableColumns(table) {
  return db.prepare(`PRAGMA table_info(${q(table)})`).all().map(col => col.name)
}

function getSafeTableCount(table) {
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).get()?.count || 0)
  } catch (_) {
    return 0
  }
}

function buildMigrationTableCounts() {
  const counts = {}
  BACKUP_TABLES.forEach((table) => {
    counts[table] = getSafeTableCount(table)
  })
  return counts
}

const MIGRATION_SAFETY_KEYS = {
  lastPreparedAt: 'scale_migration_last_prepared_at',
  localBackupAt: 'scale_migration_local_backup_at',
  localBackupRoot: 'scale_migration_local_backup_root',
  localBackupDataRoot: 'scale_migration_local_backup_data_root',
  localBackupSummaryJson: 'scale_migration_local_backup_summary_json',
  driveSyncAt: 'scale_migration_drive_sync_at',
  driveSyncStatus: 'scale_migration_drive_sync_status',
  driveSyncError: 'scale_migration_drive_sync_error',
  driveSyncSummaryJson: 'scale_migration_drive_sync_summary_json',
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

function readSystemSettings(keys = []) {
  const safeKeys = (Array.isArray(keys) ? keys : []).filter(Boolean)
  if (!safeKeys.length) return {}
  const placeholders = safeKeys.map(() => '?').join(', ')
  return db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all(...safeKeys)
    .reduce((acc, row) => {
      acc[row.key] = row.value
      return acc
    }, {})
}

function writeSystemSettings(updates = {}) {
  const entries = Object.entries(updates || {}).filter(([key]) => key)
  if (!entries.length) return
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    entries.forEach(([key, value]) => {
      if (value == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      else upsert.run(key, String(value))
    })
  })()
}

function getMigrationSafetyBackupDestination() {
  return path.join(path.dirname(STORAGE_ROOT), 'business-os-safety-backups')
}

function getMigrationSafetyState() {
  const settings = readSystemSettings(Object.values(MIGRATION_SAFETY_KEYS))
  const localBackupRoot = settings[MIGRATION_SAFETY_KEYS.localBackupRoot] || ''
  const localBackupDataRoot = settings[MIGRATION_SAFETY_KEYS.localBackupDataRoot] || ''
  return {
    lastPreparedAt: settings[MIGRATION_SAFETY_KEYS.lastPreparedAt] || '',
    localBackup: {
      createdAt: settings[MIGRATION_SAFETY_KEYS.localBackupAt] || '',
      backupRoot: localBackupRoot,
      dataRoot: localBackupDataRoot,
      exists: !!localBackupRoot && fs.existsSync(localBackupRoot),
      summary: safeJsonParse(settings[MIGRATION_SAFETY_KEYS.localBackupSummaryJson], null),
    },
    driveSync: {
      attemptedAt: settings[MIGRATION_SAFETY_KEYS.driveSyncAt] || '',
      status: settings[MIGRATION_SAFETY_KEYS.driveSyncStatus] || 'not_run',
      error: settings[MIGRATION_SAFETY_KEYS.driveSyncError] || '',
      summary: safeJsonParse(settings[MIGRATION_SAFETY_KEYS.driveSyncSummaryJson], null),
    },
  }
}

async function createMigrationSafetyBackup() {
  const destinationDir = getMigrationSafetyBackupDestination()
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
  const result = await runFsWorker('export-folder', {
    sourceRoot: STORAGE_ROOT,
    destinationDir,
    dataFolderName: DATA_FOLDER_NAME,
    backupVersion: BACKUP_VERSION,
  }, 20 * 60 * 1000)
  writeSystemSettings({
    [MIGRATION_SAFETY_KEYS.localBackupAt]: new Date().toISOString(),
    [MIGRATION_SAFETY_KEYS.localBackupRoot]: result.backupRoot || '',
    [MIGRATION_SAFETY_KEYS.localBackupDataRoot]: result.dataRoot || '',
    [MIGRATION_SAFETY_KEYS.localBackupSummaryJson]: JSON.stringify(result.summary || {}),
  })
  return result
}

async function runMigrationSafetyDriveSync() {
  const config = getDriveSyncConfig()
  if (!config.enabled || !config.ready) {
    const skipped = {
      status: 'skipped',
      reason: 'Google Drive is not connected or background sync is disabled.',
    }
    writeSystemSettings({
      [MIGRATION_SAFETY_KEYS.driveSyncAt]: new Date().toISOString(),
      [MIGRATION_SAFETY_KEYS.driveSyncStatus]: skipped.status,
      [MIGRATION_SAFETY_KEYS.driveSyncError]: skipped.reason,
      [MIGRATION_SAFETY_KEYS.driveSyncSummaryJson]: JSON.stringify({}),
    })
    return skipped
  }

  try {
    const summary = await runDriveSync('migration-safety')
    const completedAt = new Date().toISOString()
    writeSystemSettings({
      [MIGRATION_SAFETY_KEYS.driveSyncAt]: completedAt,
      [MIGRATION_SAFETY_KEYS.driveSyncStatus]: 'ok',
      [MIGRATION_SAFETY_KEYS.driveSyncError]: '',
      [MIGRATION_SAFETY_KEYS.driveSyncSummaryJson]: JSON.stringify(summary || {}),
    })
    return { status: 'ok', completedAt, summary }
  } catch (error) {
    const message = error?.message || 'Google Drive sync failed'
    writeSystemSettings({
      [MIGRATION_SAFETY_KEYS.driveSyncAt]: new Date().toISOString(),
      [MIGRATION_SAFETY_KEYS.driveSyncStatus]: 'error',
      [MIGRATION_SAFETY_KEYS.driveSyncError]: message,
      [MIGRATION_SAFETY_KEYS.driveSyncSummaryJson]: JSON.stringify({}),
    })
    return { status: 'error', error: message }
  }
}

async function runMigrationSafetyAutomation({ includeDrive = true } = {}) {
  const preparedAt = new Date().toISOString()
  const localBackup = await createMigrationSafetyBackup()
  const driveSync = includeDrive
    ? await runMigrationSafetyDriveSync()
    : { status: 'skipped', reason: 'Google Drive sync was not requested.' }
  writeSystemSettings({ [MIGRATION_SAFETY_KEYS.lastPreparedAt]: preparedAt })
  return {
    preparedAt,
    noDataMoved: true,
    localBackup,
    driveSync,
  }
}

function buildScaleMigrationStatus(queueStatus = getQueueStatus()) {
  const organization = getDefaultOrganization()
  const organizationStorage = organization ? ensureOrganizationFilesystemLayout(organization) : null
  const queue = queueStatus || getQueueStatus()
  const tableCounts = buildMigrationTableCounts()
  const totalRows = Object.values(tableCounts).reduce((sum, value) => sum + (Number(value) || 0), 0)
  const queueReady = queue?.available === true || (queue?.driver === 'bullmq' && queue?.reason === 'ready')
  const migrationEngineReady = false
  return {
    mode: 'sqlite_authoritative',
    authoritativeData: {
      databaseDriver: 'sqlite',
      databasePath: DB_PATH,
      uploadsPath: UPLOADS_PATH,
      importsPath: IMPORTS_PATH,
      storageRoot: STORAGE_ROOT,
      dataRoot: DATA_ROOT,
      organizationStorage,
    },
    scaleServices: {
      required: BUSINESS_OS_REQUIRE_SCALE_SERVICES,
      queueDriver: JOB_QUEUE_DRIVER,
      queueStatus: queue,
      redisConfigured: !!REDIS_URL,
      cacheRedisConfigured: RUNTIME_CACHE_ENABLED && !!CACHE_REDIS_URL,
      postgresConfigured: !!DATABASE_URL || DATABASE_DRIVER === 'postgres',
      minioConfigured: OBJECT_STORAGE_DRIVER === 'minio',
      s3EndpointConfigured: !!S3_ENDPOINT,
      s3Bucket: S3_BUCKET || null,
    },
    target: {
      databaseDriver: DATABASE_DRIVER || 'sqlite',
      objectStorageDriver: OBJECT_STORAGE_DRIVER || 'local',
      postgresAvailableForMigration: !!DATABASE_URL && DATABASE_DRIVER === 'postgres',
      minioAvailableForMigration: OBJECT_STORAGE_DRIVER === 'minio',
    },
    backupRequired: true,
    automation: getMigrationSafetyState(),
    canPrepareMigration: true,
    canRunMigration: migrationEngineReady,
    blockedReason: migrationEngineReady
      ? ''
      : 'SQLite/local files remain authoritative. The app can automate local backup and Google Drive safety sync now; switching live storage to Postgres/MinIO stays locked until verified adapter migration is enabled.',
    verification: {
      tableCounts,
      totalRows,
      queueReady,
    },
  }
}

function extractUploadPathsFromText(value) {
  const raw = String(value || '')
  if (!raw.includes('/uploads/')) return []
  const matches = raw.match(/\/uploads\/[^"'`\r\n]+/g) || []
  return matches
    .map((match) => match.replace(/[,\]}]+$/, '').trim())
    .filter(Boolean)
}

function collectBackupUploads() {
  const uploads = []
  const seen = new Set()

  const addUpload = (relPath) => {
    if (!relPath || typeof relPath !== 'string') return
    const normalized = relPath.trim()
    if (!normalized.startsWith('/uploads/') || seen.has(normalized)) return
    const fileName = path.basename(normalized)
    if (!fileName) return
    const filePath = path.join(UPLOADS_PATH, fileName)
    if (!fs.existsSync(filePath)) return
    uploads.push({ path: normalized, data: fs.readFileSync(filePath).toString('base64') })
    seen.add(normalized)
  }

  const uploadScans = [
    "SELECT DISTINCT image_path AS value FROM products WHERE image_path IS NOT NULL AND trim(image_path) != ''",
    "SELECT DISTINCT image_path AS value FROM product_images WHERE image_path IS NOT NULL AND trim(image_path) != ''",
    "SELECT DISTINCT avatar_path AS value FROM users WHERE avatar_path IS NOT NULL AND trim(avatar_path) != ''",
    "SELECT DISTINCT public_path AS value FROM file_assets WHERE public_path IS NOT NULL AND trim(public_path) != ''",
    "SELECT DISTINCT screenshots_json AS value FROM customer_share_submissions WHERE screenshots_json IS NOT NULL AND trim(screenshots_json) != ''",
    "SELECT DISTINCT value FROM settings WHERE value IS NOT NULL AND trim(value) != ''",
  ]

  uploadScans.forEach((sql) => {
    db.prepare(sql).all().forEach((row) => {
      extractUploadPathsFromText(row.value).forEach(addUpload)
    })
  })

  return uploads
}

function restoreBackupUploads(uploads = []) {
  if (!Array.isArray(uploads) || uploads.length === 0) return
  fs.mkdirSync(UPLOADS_PATH, { recursive: true })
  for (const file of uploads) {
    const fileName = path.basename(file.path || '')
    if (!fileName || !file.data) continue
    try { fs.writeFileSync(path.join(UPLOADS_PATH, fileName), Buffer.from(file.data, 'base64')) } catch (_) {}
  }
}

function deleteAllUploads() {
  try {
    if (!fs.existsSync(UPLOADS_PATH)) return
    for (const f of fs.readdirSync(UPLOADS_PATH)) {
      try { fs.unlinkSync(path.join(UPLOADS_PATH, f)) } catch (_) {}
    }
  } catch (_) {}
}

function getBackupDataRootCandidate(root) {
  const resolved = path.resolve(String(root || ''))
  const directDbPath = path.join(resolved, 'db', 'business.db')
  if (fs.existsSync(directDbPath)) return resolved

  const nestedDefault = path.join(resolved, DATA_FOLDER_NAME)
  const nestedDbPath = path.join(nestedDefault, 'db', 'business.db')
  if (fs.existsSync(nestedDbPath)) return nestedDefault

  return null
}

function readBackupTablesFromDataRoot(sourceRoot) {
  const root = getBackupDataRootCandidate(sourceRoot)
  if (!root) throw new Error(`No Business OS data folder was found in "${sourceRoot}"`)

  const dbPath = path.join(root, 'db', 'business.db')
  const sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true })

  try {
    const customTables = sourceDb.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
    const tables = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, sourceDb.prepare(`SELECT * FROM ${q(table)}`).all()]),
    )
    const customTableRows = Object.fromEntries(
      getCustomTableNames(customTables).map((tableName) => {
        try {
          return [tableName, sourceDb.prepare(`SELECT * FROM "${tableName}"`).all()]
        } catch (_) {
          return [tableName, []]
        }
      }),
    )

    return {
      root,
      tables,
      customTableRows,
      summary: buildBackupSummary({ tables, customTableRows, uploads: fs.existsSync(path.join(root, 'uploads')) ? fs.readdirSync(path.join(root, 'uploads')) : [] }),
    }
  } finally {
    try { sourceDb.close() } catch (_) {}
  }
}

function restoreUploadsFromDataRoot(sourceRoot) {
  const uploadSource = path.join(path.resolve(sourceRoot), 'uploads')
  deleteAllUploads()
  if (!fs.existsSync(uploadSource)) return
  fs.mkdirSync(UPLOADS_PATH, { recursive: true })
  const entries = fs.readdirSync(uploadSource, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const sourcePath = path.join(uploadSource, entry.name)
    const targetPath = path.join(UPLOADS_PATH, entry.name)
    try { fs.copyFileSync(sourcePath, targetPath) } catch (_) {}
  }
}

function restoreSnapshotTables({ tables, customTableRows, uploads, uploadSourceRoot }) {
  const providedTables = BACKUP_TABLES.filter((table) => Object.prototype.hasOwnProperty.call(tables, table))

  db.transaction(() => {
    const existingCustomTables = db.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
    getCustomTableNames(existingCustomTables).forEach((tableName) => {
      try { db.exec(`DROP TABLE IF EXISTS "${tableName}"`) } catch (_) {}
    })

    for (const table of BACKUP_CLEAR_ORDER) {
      if (!providedTables.includes(table)) continue
      replaceTableRows(table, [])
    }
    for (const table of BACKUP_TABLES) {
      if (!providedTables.includes(table)) continue
      replaceTableRows(table, tables[table])
    }

    const importedCustomTables = Array.isArray(tables.custom_tables) ? tables.custom_tables : []
    const customTableNames = new Set([
      ...getCustomTableNames(importedCustomTables),
      ...Object.keys(customTableRows || {}).filter((tableName) => tableName.startsWith('ct_')),
    ])
    customTableNames.forEach((tableName) => {
      const meta = importedCustomTables.find((row) => String(row?.name || '').trim() === tableName) || { name: tableName }
      const rows = Array.isArray(customTableRows?.[tableName]) ? customTableRows[tableName] : []
      recreateCustomTable(tableName, parseCustomTableDefinition(meta, rows))
      replaceTableRows(tableName, rows)
    })

    if (providedTables.includes('branches')) {
      const existingDefault = db.prepare('SELECT id FROM branches WHERE is_default = 1 LIMIT 1').get()
      if (!existingDefault) {
        const firstBranch = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get()
        if (firstBranch) db.prepare('UPDATE branches SET is_default = 1 WHERE id = ?').run(firstBranch.id)
      }
    }
    if (providedTables.includes('products') || providedTables.includes('branch_stock')) {
      db.prepare(`
        UPDATE products SET stock_quantity = (
          SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_stock.product_id = products.id
        ), updated_at = datetime('now')
      `).run()
    }
    repairRelationalConsistency()
    ensureCoreDataInvariants({ repairUploads: false })
  })()

  if (uploadSourceRoot) restoreUploadsFromDataRoot(uploadSourceRoot)
  else restoreBackupUploads(uploads)
  ensureCoreDataInvariants()
}

// Bulk-insert using chunked multi-value INSERT (500 rows/stmt) for speed.
// Unknown columns from older backups are silently dropped (insertColumns filter).
// Missing columns from newer schemas default to NULL.
function replaceTableRows(table, rows = []) {
  const columns = getTableColumns(table)
  if (columns.length === 0) return 0

  db.prepare(`DELETE FROM ${q(table)}`).run()
  if (columns.includes('id')) {
    try { db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table) } catch (_) {}
  }

  if (!Array.isArray(rows) || rows.length === 0) return 0

  const insertColumns = columns.filter(col => rows.some(row => Object.prototype.hasOwnProperty.call(row, col)))
  if (insertColumns.length === 0) return 0

  const CHUNK = 500
  let count = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => `(${insertColumns.map(() => '?').join(',')})`).join(',')
    const values = chunk.flatMap(row => insertColumns.map(col => row[col] ?? null))
    db.prepare(`INSERT INTO ${q(table)} (${insertColumns.map(q).join(',')}) VALUES ${placeholders}`).run(...values)
    count += chunk.length
  }

  if (columns.includes('id')) {
    const maxId = rows.reduce((max, row) => { const id = Number(row?.id || 0); return id > max ? id : max }, 0)
    if (maxId > 0) {
      try { db.prepare('INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES(?, ?)').run(table, maxId) } catch (_) {}
    }
  }
  return count
}

// Accept any version >= 1. Normalises both modern (tables:{}) and legacy
// flat-key formats so old backups always import cleanly.
function normaliseBackupTables(backup) {
  if (backup?.tables && typeof backup.tables === 'object') return backup.tables
  return {
    products:            backup?.products            || [],
    product_images:      backup?.product_images      || [],
    categories:          backup?.categories          || [],
    units:               backup?.units               || [],
    branches:            backup?.branches            || [],
    roles:               backup?.roles               || [],
    users:               backup?.users               || [],
    branch_stock:        backup?.branch_stock        || [],
    customers:           backup?.customers           || [],
    suppliers:           backup?.suppliers           || [],
    delivery_contacts:   backup?.delivery_contacts   || [],
    sales:               backup?.sales               || [],
    sale_items:          backup?.sale_items          || [],
    returns:             backup?.returns             || [],
    return_items:        backup?.return_items        || [],
    inventory_movements: backup?.inventory_movements || [],
    stock_transfers:     backup?.stock_transfers     || [],
    settings:            backup?.settings            || [],
    custom_fields:       backup?.custom_fields       || [],
    custom_tables:       backup?.custom_tables       || [],
    customer_share_submissions: backup?.customer_share_submissions || [],
    audit_logs:          backup?.audit_logs          || [],
    file_assets:         backup?.file_assets         || [],
    action_history:      backup?.action_history      || [],
  }
}

function normaliseBackupCustomTableRows(backup) {
  if (backup?.custom_table_rows && typeof backup.custom_table_rows === 'object') return backup.custom_table_rows
  return {}
}

function repairRelationalConsistency() {
  db.prepare('DELETE FROM branch_stock WHERE product_id NOT IN (SELECT id FROM products) OR branch_id NOT IN (SELECT id FROM branches)').run()
  db.prepare('DELETE FROM sale_items WHERE sale_id NOT IN (SELECT id FROM sales)').run()
  db.prepare('DELETE FROM return_items WHERE return_id NOT IN (SELECT id FROM returns)').run()
  db.prepare('UPDATE sale_items SET product_id = NULL WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)').run()
  db.prepare('UPDATE return_items SET product_id = NULL WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)').run()
}

function getCustomTableNames(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.name || '').trim())
    .filter((name) => name.startsWith('ct_'))
}

function parseCustomTableDefinition(row, sampleRows = []) {
  let schema = []
  try {
    if (row?.schema) schema = JSON.parse(row.schema)
    else if (row?.columns) schema = JSON.parse(row.columns)
  } catch (_) {
    schema = []
  }

  const fromSchema = Array.isArray(schema)
    ? schema.map((field) => {
        if (typeof field === 'string') return { name: field, sqlType: 'TEXT' }
        const name = String(field?.name || '').trim()
        if (!name) return null
        const type = String(field?.type || field?.sqlType || 'text').trim().toLowerCase()
        const sqlType = ({
          text: 'TEXT',
          long_text: 'TEXT',
          date: 'TEXT',
          timestamp: 'TEXT',
          dropdown: 'TEXT',
          number: 'INTEGER',
          boolean: 'INTEGER',
          decimal: 'REAL',
          real: 'REAL',
          integer: 'INTEGER',
        })[type] || 'TEXT'
        return { name, sqlType }
      }).filter(Boolean)
    : []

  if (fromSchema.length) return fromSchema

  const keySet = new Set()
  ;(Array.isArray(sampleRows) ? sampleRows : []).forEach((rowValue) => {
    Object.keys(rowValue || {}).forEach((key) => {
      if (key !== 'id' && key !== 'created_at') keySet.add(key)
    })
  })

  return Array.from(keySet).map((name) => ({ name, sqlType: 'TEXT' }))
}

function recreateCustomTable(tableName, columns = []) {
  const defs = columns
    .map((column) => `"${String(column.name).replace(/"/g, '')}" ${column.sqlType || 'TEXT'}`)
    .join(', ')
  const sql = defs
    ? `CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${defs}, created_at TEXT DEFAULT (datetime('now')))`
    : `CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')))`
  db.exec(sql)
}

function broadcastDataRestored() {
  ;['products', 'inventory', 'sales', 'returns', 'customers', 'suppliers', 'settings', 'dashboard', 'users', 'roles', 'customTables', 'portalSubmissions', 'actionHistory', 'runtime'].forEach(broadcast)
}

function getDefaultBackupDestinationDir() {
  const configured = String(process.env.BUSINESS_OS_BACKUP_DIR || '').trim()
  if (configured) return path.resolve(configured)
  return path.resolve(STORAGE_ROOT, 'backups')
}

async function createFolderBackup({ destinationDir, actor = {}, progress = null } = {}) {
  const rawDestination = String(destinationDir || getDefaultBackupDestinationDir()).trim()
  const resolvedDestination = path.resolve(rawDestination)
  if (isSamePath(resolvedDestination, DATA_ROOT) || isSubPath(DATA_ROOT, resolvedDestination)) {
    throw new Error('Choose a backup destination outside the current live data folder.')
  }
  progress?.({
    phase: 'snapshotting',
    progress: 10,
    message: 'Creating a safe filesystem snapshot',
  })
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
  const workerResult = await runFsWorker('export-folder', {
    sourceRoot: DATA_ROOT,
    destinationDir: resolvedDestination,
    dataFolderName: DATA_FOLDER_NAME,
    backupVersion: BACKUP_VERSION,
  })
  audit(actor.userId, actor.userName, 'backup_export', 'system', null, {
    destinationDir: resolvedDestination,
    backupRoot: workerResult.backupRoot,
    files: workerResult.copyStats?.copiedFileCount || 0,
  })
  return {
    backupRoot: workerResult.backupRoot,
    dataRoot: workerResult.dataRoot,
    infoPath: workerResult.infoPath,
    summary: workerResult.summary,
    copyStats: workerResult.copyStats,
    message: 'Folder backup created successfully.',
  }
}

async function restoreFolderBackup({ sourceDir, actor = {}, progress = null } = {}) {
  const rawSource = String(sourceDir || '').trim()
  if (!rawSource) throw new Error('sourceDir is required')
  progress?.({
    phase: 'validating',
    progress: 5,
    message: 'Validating backup folder',
  })
  const snapshot = readBackupTablesFromDataRoot(rawSource)
  if (isSamePath(snapshot.root, DATA_ROOT)) {
    throw new Error('Choose a backup folder, not the current live data folder.')
  }
  progress?.({
    phase: 'stopping_imports',
    progress: 20,
    message: 'Stopping background imports before restore',
  })
  await stopImportsBeforeDestructiveAction('Folder backup restore')
  progress?.({
    phase: 'restoring',
    progress: 45,
    message: 'Restoring database tables and uploads',
  })
  restoreSnapshotTables({
    tables: snapshot.tables,
    customTableRows: snapshot.customTableRows,
    uploadSourceRoot: snapshot.root,
  })
  bumpStorageVersion('backup-import-folder')
  audit(actor.userId, actor.userName, 'backup_restore', 'system', null, {
    sourceDir: snapshot.root,
    tableRows: snapshot.summary?.totals?.tableRowCount || 0,
  })
  broadcastDataRestored()
  return {
    message: 'Folder backup restored successfully',
    sourceRoot: snapshot.root,
    summary: snapshot.summary,
  }
}

// ?€?€ Audit log ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
router.get('/audit-logs', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all())
})

router.get('/debug/log', authToken, (req, res) => {
  res.json({ entries: getServerLog().slice(0, 200), clients: wss_clients.size, uptime: process.uptime() })
})

const SERVER_START_TIME = Math.floor(Date.now() / 1000)

router.get('/config', authToken, (req, res) => {
  const access = classifyRequestAccess(req)
  const { hostUiAvailable } = getHostUiAvailability(req)
  const organization = getDefaultOrganization()
  res.json({
    syncServerUrl: PUBLIC_BASE_URL || CLOUDFLARE_PUBLIC_URL || null,
    adminServerUrl: CLOUDFLARE_ADMIN_URL || null,
    requiresToken: access.tokenRequired,
    hasConfiguredToken: access.hasConfiguredToken,
    accessMode: access.mode,
    trustedTailscale: access.trustedTailscale,
    tokenAccepted: access.tokenValid,
    hostUiAvailable,
    serverStartTime: SERVER_START_TIME,
    runtime: {
      ...buildRuntimeDescriptor(organization?.public_id || ''),
      serverStartTime: String(SERVER_START_TIME),
    },
    backup: {
      defaultDestinationDir: getDefaultBackupDestinationDir(),
    },
    security: {
      configuredTailscaleHost: access.configuredTailscaleHost || null,
      host: access.host || null,
      remoteAddress: access.remoteAddress || null,
      mode: access.mode,
      publicRemote: access.publicRemote,
      tokenRequired: access.tokenRequired,
      hasConfiguredToken: access.hasConfiguredToken,
      tokenProvided: access.tokenProvided,
      trustedTailscale: access.trustedTailscale,
      hostUiAvailable,
    },
  })
})

// ?€?€ Backup export ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
router.get('/drive-sync/status', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  ok(res, {
    item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
  })
})

router.get('/jobs/:id', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  const item = getSystemJob(req.params.id)
  if (!item) return err(res, 'Job not found', 404)
  ok(res, { item })
})

router.get('/jobs', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  ok(res, { items: listSystemJobs({ limit: req.query?.limit || 25 }) })
})

router.post('/drive-sync/preferences', authToken, requirePermission('settings'), (req, res) => {
  try {
    saveDriveSyncPreferences(req.body || {})
    ok(res, {
      item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
    })
  } catch (error) {
    err(res, error?.message || 'Failed to save Google Drive sync settings')
  }
})

router.post('/drive-sync/oauth/start', authToken, requirePermission('settings'), (req, res) => {
  try {
    const existing = getDriveSyncConfig()
    const clientId = String(req.body?.clientId || existing.clientId || '').trim()
    const clientSecret = String(req.body?.clientSecret || existing.clientSecret || '').trim()
    if (!clientId || !clientSecret) return err(res, 'Google OAuth client ID and client secret are required.')

    const baseUrl = buildRequestBaseUrl(req)
    const redirectUri = resolveDriveRedirectUri(req)
    if (!redirectUri) return err(res, 'Could not determine the current server URL for Google Drive setup.')
    const state = beginGoogleDriveOAuth({
      clientId,
      clientSecret,
      folderName: req.body?.folderName,
      deleteMissing: req.body?.deleteMissing,
      syncIntervalSeconds: req.body?.syncIntervalSeconds,
      enabled: req.body?.enabled !== false,
      redirectUri,
      returnOrigin: String(req.body?.returnOrigin || baseUrl || '').trim(),
      returnPath: String(req.body?.returnPath || '/').trim() || '/',
      userId: req.user?.id,
      userName: req.user?.name || req.user?.username,
    })

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPE)
    authUrl.searchParams.set('state', state)

    ok(res, {
      authUrl: authUrl.toString(),
      redirectUri,
      scope: GOOGLE_DRIVE_SCOPE,
    })
  } catch (error) {
    err(res, error?.message || 'Failed to start Google Drive connection')
  }
})

router.get('/drive-sync/oauth/callback', async (req, res) => {
  const failure = String(req.query?.error || '').trim()
  if (failure) {
    res.status(400).send(`<!doctype html><html><body style="font-family:system-ui;padding:24px"><h2>Google Drive connection failed</h2><p>${failure}</p><script>try{if(window.opener){window.opener.postMessage({type:'business-os-drive-sync',status:'error',message:${JSON.stringify(failure)}},'*');}}catch(e){};</script></body></html>`)
    return
  }

  try {
    const result = await finalizeGoogleDriveOAuth({
      state: req.query?.state,
      code: req.query?.code,
    })
    const targetOrigin = String(result.returnOrigin || buildRequestBaseUrl(req) || '').replace(/\/$/, '')
    const targetPath = String(result.returnPath || '/')
    const targetUrl = `${targetOrigin}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}` || '/'
    const payload = JSON.stringify({
      type: 'business-os-drive-sync',
      status: 'connected',
      email: result.email || '',
      name: result.name || '',
    })
    res.send(`<!doctype html><html><body style="font-family:system-ui;padding:24px"><h2>Google Drive connected</h2><p>You can return to Business OS now.</p><script>const payload=${payload};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,'*');window.close();}else{window.location.replace(${JSON.stringify(targetUrl)});}}catch(e){window.location.replace(${JSON.stringify(targetUrl)});}</script></body></html>`)
  } catch (error) {
    const message = String(error?.message || 'Unknown error')
    res.status(400).send(`<!doctype html><html><body style="font-family:system-ui;padding:24px"><h2>Google Drive connection failed</h2><p>${message}</p><script>try{if(window.opener){window.opener.postMessage({type:'business-os-drive-sync',status:'error',message:${JSON.stringify(message)}},'*');}}catch(e){};</script></body></html>`)
  }
})

router.post('/drive-sync/disconnect', authToken, requirePermission('settings'), (req, res) => {
  try {
    disconnectDriveSync()
    ok(res, { success: true })
  } catch (error) {
    err(res, error?.message || 'Failed to disconnect Google Drive sync')
  }
})

router.post('/drive-sync/forget-credentials', authToken, requirePermission('settings'), (req, res) => {
  if (req.body?.confirm !== true) {
    return err(res, 'Confirmation is required to forget Google Drive app credentials.', 400)
  }

  try {
    const result = forgetDriveSyncCredentials()
    ok(res, {
      success: true,
      ...result,
      item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
    })
  } catch (error) {
    err(res, error?.message || 'Failed to forget Google Drive app credentials')
  }
})

router.post('/drive-sync/jobs', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  try {
    const actor = getAuditActor(req, req.body || {})
    const job = startSystemJob('google_drive_sync', async ({ progress }) => {
      progress({ phase: 'syncing', progress: 20, message: 'Syncing backups to Google Drive' })
      const summary = await runDriveSync('manual')
      audit(actor.userId, actor.userName, 'drive_sync', 'system', null, {
        reason: 'manual',
        uploaded: summary?.uploaded || 0,
        updated: summary?.updated || 0,
        skipped: summary?.skipped || 0,
      })
      return {
        summary,
        item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
      }
    }, {
      prefix: 'drive',
      message: 'Google Drive sync queued',
      runningMessage: 'Google Drive sync running',
      completedMessage: 'Google Drive sync complete',
    })
    ok(res, { job_id: job.id, item: job })
  } catch (error) {
    err(res, error?.message || 'Google Drive sync failed')
  }
})

router.post('/drive-sync/sync-now', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  try {
    const actor = getAuditActor(req, req.body || {})
    const job = startSystemJob('google_drive_sync', async ({ progress }) => {
      progress({ phase: 'syncing', progress: 20, message: 'Syncing backups to Google Drive' })
      const summary = await runDriveSync('manual')
      audit(actor.userId, actor.userName, 'drive_sync', 'system', null, {
        reason: 'manual',
        uploaded: summary?.uploaded || 0,
        updated: summary?.updated || 0,
        skipped: summary?.skipped || 0,
      })
      return {
        summary,
        item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
      }
    }, {
      prefix: 'drive',
      message: 'Google Drive sync queued',
      runningMessage: 'Google Drive sync running',
      completedMessage: 'Google Drive sync complete',
    })
    ok(res, {
      queued: true,
      job_id: job.id,
      job,
      item: getDriveSyncStatus(resolveDriveRedirectUri(req)),
    })
  } catch (error) {
    err(res, error?.message || 'Google Drive sync failed')
  }
})

router.get('/backups/:id', authToken, requirePermission('backup'), (req, res) => {
  const item = getSystemJob(req.params.id)
  if (!item) return err(res, 'Backup job not found', 404)
  ok(res, { item })
})

router.post('/backups', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_job', max: 12, windowMs: 10 * 60 * 1000 })) return
  const type = String(req.body?.type || 'export-folder').trim().toLowerCase()
  const actor = getAuditActor(req, req.body || {})
  try {
    if (type === 'export-folder' || type === 'export_folder') {
      const destinationDir = String(req.body?.destinationDir || '').trim() || getDefaultBackupDestinationDir()
      const job = startSystemJob('backup_export_folder', ({ progress }) => createFolderBackup({
        destinationDir,
        actor,
        progress,
      }), {
        prefix: 'backup',
        message: 'Backup export queued',
        runningMessage: 'Backup export running',
        completedMessage: 'Backup export complete',
      })
      return ok(res, { job_id: job.id, item: job })
    }
    if (['import-folder', 'import_folder', 'restore-folder', 'restore_folder'].includes(type)) {
      const sourceDir = String(req.body?.sourceDir || '').trim()
      if (!sourceDir) return err(res, 'sourceDir is required')
      const job = startSystemJob('backup_restore_folder', ({ progress }) => restoreFolderBackup({
        sourceDir,
        actor,
        progress,
      }), {
        prefix: 'restore',
        message: 'Backup restore queued',
        runningMessage: 'Backup restore running',
        completedMessage: 'Backup restore complete',
      })
      return ok(res, { job_id: job.id, item: job })
    }
    return err(res, `Unsupported backup job type: ${type}`, 400)
  } catch (error) {
    return err(res, error?.message || 'Failed to start backup job')
  }
})

router.post('/backups/:id/restore', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_restore_job', max: 6, windowMs: 10 * 60 * 1000 })) return
  const sourceDir = String(req.body?.sourceDir || req.body?.backupRoot || '').trim()
  if (!sourceDir) return err(res, 'sourceDir is required')
  const actor = getAuditActor(req, req.body || {})
  const job = startSystemJob('backup_restore_folder', ({ progress }) => restoreFolderBackup({
    sourceDir,
    actor,
    progress,
  }), {
    prefix: 'restore',
    message: 'Backup restore queued',
    runningMessage: 'Backup restore running',
    completedMessage: 'Backup restore complete',
  })
  ok(res, { job_id: job.id, item: job })
})

router.get('/backup/export', authToken, requirePermission('backup'), (req, res) => {
  const customTables = db.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
  const tables = Object.fromEntries(
    BACKUP_TABLES.map(table => [table, db.prepare(`SELECT * FROM ${q(table)}`).all()])
  )
  const uploads = collectBackupUploads()
  const customTableRows = Object.fromEntries(
    getCustomTableNames(customTables).map((tableName) => {
      try {
        return [tableName, db.prepare(`SELECT * FROM "${tableName}"`).all()]
      } catch (_) {
        return [tableName, []]
      }
    })
  )
  const backup = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    tables,
    custom_table_rows: customTableRows,
    uploads,
    summary: buildBackupSummary({ tables, uploads, customTableRows }),
  }
  res.setHeader('Content-Disposition', `attachment; filename="business-os-backup-${today()}.json"`)
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(backup, null, 2))
})

router.post('/backup/export-folder', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_export_folder', max: 12, windowMs: 10 * 60 * 1000 })) return
  const destinationDir = String(req.body?.destinationDir || '').trim() || getDefaultBackupDestinationDir()

  try {
    return ok(res, await createFolderBackup({
      destinationDir,
      actor: { userId: req.user?.id, userName: req.user?.name },
    }))
  } catch (e) {
    return err(res, `Failed to create folder backup: ${e.message}`)
  }
})

// ?€?€ Backup import ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
// Accepts any version >= 1. Unknown columns are dropped, missing columns default to NULL.
router.post('/backup/import', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import', max: 6, windowMs: 10 * 60 * 1000 })) return
  const backup = req.body
  if (!backup || typeof backup !== 'object') return err(res, 'Invalid backup ??expected a JSON object')
  const ver = backup.version
  if (typeof ver !== 'number' || ver < 1) {
    return err(res, `Unsupported backup version: ${ver}. File must be a Business OS backup (v1 or higher).`)
  }

  const tables = normaliseBackupTables(backup)
  const customTableRows = normaliseBackupCustomTableRows(backup)

  try {
    await stopImportsBeforeDestructiveAction('Backup restore')
    restoreSnapshotTables({ tables, customTableRows, uploads: backup.uploads })
    bumpStorageVersion('backup-import')
  } catch (e) {
    return err(res, e.message)
  }

  ;['products', 'inventory', 'sales', 'returns', 'customers', 'suppliers', 'settings', 'dashboard', 'users', 'roles', 'customTables', 'portalSubmissions', 'actionHistory', 'runtime'].forEach(broadcast)
  ok(res, { message: 'Backup imported successfully' })
})

router.post('/backup/import-folder', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import_folder', max: 6, windowMs: 10 * 60 * 1000 })) return
  const sourceDir = String(req.body?.sourceDir || '').trim()
  if (!sourceDir) return err(res, 'sourceDir is required')

  try {
    const result = await restoreFolderBackup({
      sourceDir,
      actor: { userId: req.user?.id, userName: req.user?.name },
    })
    return ok(res, result)
  } catch (e) {
    return err(res, `Failed to restore folder backup: ${e.message}`)
  }
})

// ?€?€ Reset business data ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
// mode='sales' ??clear all transactional data (sales, RETURNS, stock movements); zero stock
// mode='all'   ??also remove products, contacts, custom_fields; keep settings/users/branches
router.post('/reset-data', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:reset_data', max: 5, windowMs: 10 * 60 * 1000 })) return
  const { mode = 'sales' } = req.body || {}
  const actor = getAuditActor(req, req.body || {})
  try {
    const importStopSummary = await stopImportsBeforeDestructiveAction(mode === 'all' ? 'Full data reset' : 'Sales reset')
    db.transaction(() => {
      // Always clear transactional data (sales AND returns)
      db.prepare('DELETE FROM return_items').run()
      db.prepare('DELETE FROM returns').run()
      db.prepare('DELETE FROM sale_items').run()
      db.prepare('DELETE FROM sales').run()
      db.prepare('DELETE FROM inventory_movements').run()
      db.prepare('DELETE FROM stock_transfers').run()
      db.prepare('UPDATE branch_stock SET quantity = 0').run()

      if (mode === 'all') {
        db.prepare('DELETE FROM products').run()
        db.prepare('DELETE FROM branch_stock').run()
        db.prepare('DELETE FROM customers').run()
        db.prepare('DELETE FROM suppliers').run()
        db.prepare('DELETE FROM delivery_contacts').run()
        db.prepare('DELETE FROM custom_fields').run()
        db.prepare('DELETE FROM import_job_errors').run()
        db.prepare('DELETE FROM import_job_batches').run()
        db.prepare('DELETE FROM import_job_files').run()
        db.prepare('DELETE FROM import_jobs').run()
        db.prepare('DELETE FROM action_history').run()
        // Keep: branches, categories, units, settings, users
      } else {
        db.prepare('UPDATE products SET stock_quantity = 0').run()
        db.prepare('DELETE FROM action_history').run()
      }
    })()

    if (mode === 'all') {
      await deleteAllImportJobs({ removeFiles: true })
    }

    const label = mode === 'all'
      ? 'Full data reset ??sales, returns, products, contacts cleared'
      : 'Sales reset ??sales, returns, and stock cleared'
    bumpStorageVersion(mode === 'all' ? 'reset-data-all' : 'reset-data-sales')
    audit(actor.userId, actor.userName, 'reset_data', 'system', null, {
      label,
      cancelledImportJobs: importStopSummary.cancelled || 0,
    })
    ;['sales', 'returns', 'products', 'inventory', 'customers', 'dashboard', 'actionHistory', 'runtime'].forEach(broadcast)
    ok(res, {
      message: mode === 'all'
        ? 'Reset complete ??sales, returns, products, and contacts deleted. Settings, users, and branches kept.'
        : 'Sales reset ??sales, returns, and stock cleared. Products and contacts kept.',
    })
  } catch (e) { err(res, e.message) }
})

// ?€?€ Factory reset (wipe everything; keep admin + rebuild defaults) ?€?€?€?€?€?€?€?€?€?€?€?€
router.post('/factory-reset', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:factory_reset', max: 2, windowMs: 30 * 60 * 1000 })) return
  const actor = getAuditActor(req, req.body || {})
  try {
    const importStopSummary = await stopImportsBeforeDestructiveAction('Factory reset')
    db.transaction(() => {
      // FK-safe deletion order ??returns and return_items included
      const existingCustomTables = db.prepare(`SELECT * FROM ${q('custom_tables')}`).all()
      getCustomTableNames(existingCustomTables).forEach((tableName) => {
        try { db.exec(`DROP TABLE IF EXISTS "${tableName}"`) } catch (_) {}
      })

      const tables = [
        'verification_codes', 'user_sessions',
        'customer_share_submissions',
        'product_images',
        'return_items', 'returns',
        'sale_items', 'sales',
        'inventory_movements', 'branch_stock', 'stock_transfers',
        'products', 'categories', 'units',
        'suppliers', 'customers', 'delivery_contacts',
        'branches', 'custom_fields', 'custom_tables',
        'import_job_errors', 'import_job_batches', 'import_job_files', 'import_jobs',
        'file_assets', 'ai_response_logs', 'ai_provider_configs', 'google_drive_sync_entries',
        'action_history',
        'roles', 'audit_logs', 'settings', 'users',
      ]
      tables.forEach(t => { try { db.prepare(`DELETE FROM "${t}"`).run() } catch (_) {} })
      ensureCoreDataInvariants()
    })()

    // Remove all uploaded images ??factory reset = clean slate
    deleteAllUploads()
    await deleteAllImportJobs({ removeFiles: true })
    ensureCoreDataInvariants()
    bumpStorageVersion('factory-reset')
    audit(actor.userId, actor.userName, 'factory_reset', 'system', null, {
      label: 'Factory reset completed',
      cancelledImportJobs: importStopSummary.cancelled || 0,
    })

    ;['products', 'sales', 'returns', 'customers', 'inventory', 'dashboard', 'settings', 'users', 'roles', 'files', 'customTables', 'actionHistory', 'runtime'].forEach(broadcast)
    ok(res, { message: 'Factory reset complete. All data and images wiped. Admin account and defaults restored.' })
  } catch (e) { err(res, e.message) }
})

// ?€?€ Offline sync push ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
router.post('/sync/push', authToken, (req, res) => {
  const { operations = [] } = req.body || {}
  res.json({ applied: operations.map(op => op.id).filter(Boolean) })
})

// ?€?€ Data Integrity Check & Repair ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * GET /api/system/verify-integrity ??Run data integrity checks without repairs.
 * Read-only operation to detect inconsistencies.
 */
router.get('/verify-integrity', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  let result = null
  const rollbackMarker = Symbol('verify-integrity')
  try {
    const verifyTx = db.transaction(() => {
      result = runDataIntegrityCheck()
      throw rollbackMarker
    })
    try {
      verifyTx()
    } catch (error) {
      if (error !== rollbackMarker) { throw error }
    }
    const integrityResult = result || {}
    res.json({
      ...integrityResult,
      success: true,
      healthy: Array.isArray(integrityResult.errors) ? integrityResult.errors.length === 0 : true,
      action: 'verify-only'
    })
  } catch (e) {
    err(res, 'Integrity check failed: ' + e.message)
  }
})

/**
 * POST /api/system/repair-integrity ??Run data integrity checks AND repair.
 * This modifies the database. Should be used carefully.
 */
router.post('/repair-integrity', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  try {
    const result = runDataIntegrityCheck()
    
    if (result.repairs > 0) {
      // Broadcast updates since we made changes
      ;['products', 'sales', 'inventory', 'dashboard'].forEach(broadcast)
      
      // Log the repair action
      audit(req.user?.id, req.user?.name, 'repair', 'data-integrity', null,
        { repairs: result.repairs, errors: result.errors.length },
        { deviceName: req.body?.device_name, deviceTz: req.body?.device_tz })
    }

    res.json({
      ...result,
      success: true,
      healthy: Array.isArray(result.errors) ? result.errors.length === 0 : true,
      action: 'repair-and-verify'
    })
  } catch (e) {
    err(res, `Integrity repair failed: ${e.message}`)
  }
})

// ?€?€ Data folder location ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
/**
 * GET /api/system/data-path
 * Returns the current data folder path and whether data-location.json exists.
 */
router.get('/data-path', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  const hasOverride = fs.existsSync(DATA_LOCATION_FILE)
  const organization = getDefaultOrganization()
  const organizationStorage = organization ? ensureOrganizationFilesystemLayout(organization) : null
  const organizationStorageStatus = organization ? getOrganizationStorageStatus(organization) : null
  res.json({
    dataRoot: DATA_ROOT,
    dataRootParent: path.dirname(STORAGE_ROOT),
    storageRoot: STORAGE_ROOT,
    storageRootParent: path.dirname(STORAGE_ROOT),
    dataFolderName: DATA_FOLDER_NAME,
    isDefaultLocation: !hasOverride,
    defaultDataRoot: DEFAULT_STORAGE_ROOT,
    hasOverride,
    locationFile: DATA_LOCATION_FILE,
    summary: summarizeDataRoot(DATA_ROOT),
    organizationStorage,
    organizationStorageStatus,
  })
})

router.get('/scale-migration/status', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  try {
    const queueStatus = await initializeBullQueue()
    ok(res, { item: buildScaleMigrationStatus({ ...getQueueStatus(), ...queueStatus }) })
  } catch (e) {
    err(res, `Scale migration status failed: ${e.message}`)
  }
})

router.post('/scale-migration/prepare', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:scale_migration_prepare', max: 12, windowMs: 10 * 60 * 1000 })) return
  try {
    const queueStatus = await initializeBullQueue()
    const beforeStatus = buildScaleMigrationStatus({ ...getQueueStatus(), ...queueStatus })
    const safety = await runMigrationSafetyAutomation({ includeDrive: req.body?.includeDrive !== false })
    const status = buildScaleMigrationStatus({ ...getQueueStatus(), ...queueStatus })
    audit(req.user?.id, req.user?.name, 'prepare_migration_check', 'system', null, {
      mode: status.mode,
      totalRows: status.verification?.totalRows || 0,
      queueDriver: status.scaleServices?.queueStatus?.driver || status.scaleServices?.queueDriver,
      canRunMigration: status.canRunMigration,
      localBackupRoot: safety.localBackup?.backupRoot,
      driveSyncStatus: safety.driveSync?.status,
      previousSafetyBackup: beforeStatus.automation?.localBackup?.backupRoot || '',
    }, { deviceName: req.body?.device_name, deviceTz: req.body?.device_tz })
    ok(res, {
      item: {
        ...status,
        preparedAt: safety.preparedAt,
        requiresFreshBackup: false,
        safety,
        message: 'Safety automation completed. A local backup was created, Google Drive sync was attempted when connected, and no live data was moved.',
      },
    })
  } catch (e) {
    err(res, `Scale migration safety automation failed: ${e.message}`)
  }
})

router.post('/scale-migration/run', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:scale_migration_run', max: 3, windowMs: 60 * 60 * 1000 })) return
  const confirmation = String(req.body?.confirmation || '').trim().toUpperCase()
  if (confirmation !== 'MIGRATE') {
    return err(res, 'Type MIGRATE to confirm a verified migration run.', 400)
  }
  audit(req.user?.id, req.user?.name, 'blocked_migration_run', 'system', null, {
    reason: 'migration_runner_locked',
  }, { deviceName: req.body?.device_name, deviceTz: req.body?.device_tz })
  return err(res, 'Verified Postgres/MinIO migration is not enabled yet. Run Prepare migration check and keep using SQLite/local files until migration verification is available.', 409)
})

/**
 * POST /api/system/data-path
 * Body: { dataDir: "C:\\new\\path\\business-os-data" }
 * Validates the path is accessible then writes data-location.json.
 * The server must be restarted for the new path to take effect.
 */
router.post('/data-path', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:data_path_update', max: 20, windowMs: 10 * 60 * 1000 })) return
  const { dataDir } = req.body || {}
  if (!dataDir || typeof dataDir !== 'string' || !dataDir.trim()) {
    return err(res, 'dataDir is required')
  }
  const rawTarget = dataDir.trim()
  if (rawTarget.toLowerCase() === '__default__' || rawTarget.toLowerCase() === 'default') {
    try {
      const migration = isSamePath(STORAGE_ROOT, DEFAULT_STORAGE_ROOT)
        ? {
            sourceSummary: summarizeDataRoot(DATA_ROOT),
            targetSummaryBefore: summarizeDataRoot(DEFAULT_STORAGE_ROOT),
            targetSummaryAfter: summarizeDataRoot(DEFAULT_STORAGE_ROOT),
            copyStats: { copiedFileCount: 0, copiedBytes: 0 },
            skipped: true,
          }
        : await (async () => {
            try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
            return runFsWorker('relocate-data-root', {
              sourceRoot: STORAGE_ROOT,
              targetRoot: DEFAULT_STORAGE_ROOT,
            })
          })()
      if (fs.existsSync(DATA_LOCATION_FILE)) fs.unlinkSync(DATA_LOCATION_FILE)
      return ok(res, {
        dataDir: DEFAULT_STORAGE_ROOT,
        dataRootParent: path.dirname(DEFAULT_STORAGE_ROOT),
        dataFolderName: DATA_FOLDER_NAME,
        migration,
        message: 'Default data folder restored. Current live data was copied there and the previous folder was left untouched for safety. Restart the server to apply.',
      })
    } catch (e) {
      return err(res, `Failed to reset data location: ${e.message}`)
    }
  }

  const target = normalizeSelectedDataDir(rawTarget)
  if (!target) return err(res, 'dataDir is required')

  try {
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
    const migration = await runFsWorker('relocate-data-root', {
      sourceRoot: STORAGE_ROOT,
      targetRoot: target,
    })
    writeDataLocation(target)
    ok(res, {
      dataDir: target,
      dataRootParent: path.dirname(target),
      dataFolderName: DATA_FOLDER_NAME,
      migration,
      message: 'Data folder updated. Current live data was copied to the new location and the previous folder was left untouched for safety. Restart the server to apply.',
    })
  } catch (e) {
    err(res, `Failed to update data folder: ${e.message}`)
  }
})

/**
 * DELETE /api/system/data-path
 * Removes data-location.json ??reverts to the default business-os-data folder.
 */
router.delete('/data-path', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:data_path_delete', max: 20, windowMs: 10 * 60 * 1000 })) return
  try {
    const migration = isSamePath(STORAGE_ROOT, DEFAULT_STORAGE_ROOT)
      ? {
          sourceSummary: summarizeDataRoot(DATA_ROOT),
          targetSummaryBefore: summarizeDataRoot(DEFAULT_STORAGE_ROOT),
          targetSummaryAfter: summarizeDataRoot(DEFAULT_STORAGE_ROOT),
          copyStats: { copiedFileCount: 0, copiedBytes: 0 },
          skipped: true,
        }
      : await (async () => {
          try { db.pragma('wal_checkpoint(TRUNCATE)') } catch (_) {}
          return runFsWorker('relocate-data-root', {
            sourceRoot: STORAGE_ROOT,
            targetRoot: DEFAULT_STORAGE_ROOT,
          })
        })()
    if (fs.existsSync(DATA_LOCATION_FILE)) fs.unlinkSync(DATA_LOCATION_FILE)
    ok(res, {
      migration,
      message: 'Reverted to the default data folder. Current live data was copied there and the previous folder was left untouched for safety. Restart the server to apply.',
    })
  } catch (e) {
    err(res, e.message)
  }
})

/**
 * POST /api/system/browse-dir
 * Body: { dir: "C:\\some\\path" }  ??lists subdirectories one level deep.
 * Used by the frontend folder-picker.
 */
router.post('/browse-dir', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  const { dir } = req.body || {}
  const requested = dir && dir.trim() ? dir.trim() : ''
  const listWindowsFsRoots = () => {
    const roots = new Set()

    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      try {
        if (fs.existsSync(drive)) roots.add(drive)
      } catch (_) {}
    }

    if (!roots.size) roots.add(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\')

    return Array.from(roots)
      .sort((a, b) => a.localeCompare(b))
      .map((fullPath) => ({ name: fullPath, fullPath, kind: 'drive' }))
  }

  const listDriveRoots = () => {
    if (process.platform !== 'win32') {
      const roots = ['/', process.env.HOME].filter(Boolean)
      return Array.from(new Set(roots)).map((fullPath) => ({
        name: fullPath === '/' ? 'Root' : fullPath,
        fullPath,
        kind: 'folder',
      }))
    }
    const favorites = [
      { name: 'Desktop', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Desktop') },
      { name: 'Documents', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Documents') },
      { name: 'Downloads', fullPath: path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'Downloads') },
      { name: 'Business OS data', fullPath: DATA_ROOT },
      { name: 'Business OS folder', fullPath: path.resolve(RUNTIME_DIR, '..') },
    ]
      .filter((entry) => {
        try { return entry.fullPath && fs.existsSync(entry.fullPath) } catch (_) { return false }
      })
      .map((entry) => ({ ...entry, kind: 'folder' }))

    return [...favorites, ...listWindowsFsRoots()]
  }

  if (!requested || requested === '__ROOTS__') {
    return res.json({
      base: 'This PC',
      parent: null,
      dirs: listDriveRoots(),
      isRootList: true,
    })
  }

  const base = requested
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true })
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, fullPath: path.join(base, e.name), kind: 'folder' }))
    const parent = path.dirname(base)
    const isDriveRoot = process.platform === 'win32' && /^[A-Za-z]:\\?$/.test(base)
    res.json({ base, parent: isDriveRoot ? '__ROOTS__' : (parent !== base ? parent : null), dirs, isRootList: false })
  } catch (e) {
    res.json({ base, parent: null, dirs: [], error: e.message, isRootList: false })
  }
})

router.post('/open-path', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:open_path', max: 30, windowMs: 60 * 1000 })) return
  const { hostUiAvailable } = getHostUiAvailability(req)
  if (!hostUiAvailable) {
    return ok(res, {
      opened: false,
      unavailable: true,
      reason: 'remote_session',
      message: 'Open folder is only available on the server machine. Remote sessions should paste or browse server paths manually instead.',
    })
  }
  const target = String(req.body?.path || '').trim()
  if (!target) return err(res, 'path is required')

  const resolved = path.resolve(target)
  if (!fs.existsSync(resolved)) return err(res, 'Path does not exist')

  try {
    const child = spawn('explorer.exe', [resolved], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    ok(res, { path: resolved, opened: true })
  } catch (e) {
    err(res, `Failed to open path: ${e.message}`)
  }
})

router.post('/pick-folder', authToken, requireAnyPermission(['backup', 'settings']), (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:pick_folder', max: 20, windowMs: 10 * 60 * 1000 })) return
  const { hostUiAvailable } = getHostUiAvailability(req)
  if (!hostUiAvailable) {
    return ok(res, {
      selectedPath: null,
      cancelled: true,
      unavailable: true,
      reason: 'remote_session',
      message: 'The native folder picker only works on the server machine. Use Browse folders or type a server path manually when connected remotely.',
    })
  }
  if (process.platform !== 'win32') {
    return ok(res, { selectedPath: null, cancelled: true, unavailable: true })
  }

  const initialPathRaw = String(req.body?.initialPath || '').trim()
  const initialPath = initialPathRaw && fs.existsSync(initialPathRaw) ? initialPathRaw : DATA_ROOT
  const escapedPath = String(initialPath || '').replace(/'/g, "''")

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select Business OS data folder'",
    '$dialog.ShowNewFolderButton = $true',
    escapedPath ? `if (Test-Path -LiteralPath '${escapedPath}') { $dialog.SelectedPath = '${escapedPath}' }` : '',
    '$result = $dialog.ShowDialog()',
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].filter(Boolean).join('; ')

  const picker = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let responded = false
  const timer = setTimeout(() => {
    try { picker.kill() } catch (_) {}
    if (responded) return
    responded = true
    err(res, 'Folder picker timed out. Close any picker window on the server device and try again.')
  }, 300000)

  picker.stdout.on('data', (chunk) => { stdout += String(chunk || '') })
  picker.stderr.on('data', (chunk) => { stderr += String(chunk || '') })
  picker.on('error', (error) => {
    if (responded) return
    responded = true
    clearTimeout(timer)
    err(res, `Folder picker failed: ${error.message}`)
  })
  picker.on('close', (code) => {
    if (responded) return
    responded = true
    clearTimeout(timer)
    const selectedPath = String(stdout || '').trim()
    if (!selectedPath) {
      if (code !== 0 && String(stderr || '').trim()) {
        return err(res, `Folder picker failed: ${String(stderr || '').trim()}`)
      }
      return ok(res, { selectedPath: null, cancelled: true })
    }
    return ok(res, { selectedPath, cancelled: false })
  })
})

module.exports = router





