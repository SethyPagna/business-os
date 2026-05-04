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
  ANALYTICS_ENGINE,
  PARQUET_STORE,
} = require('../../config')
const {
  summarizeDataRoot,
  isSamePath,
  isSubPath,
} = require('../../dataPath')
const {
  BACKUP_VERSION,
  BACKUP_TABLES,
  buildBackupSummary,
} = require('../../backupSchema')
const { ok, err, audit, broadcast, today, getServerLog, wss_clients, runDataIntegrityCheck } = require('../../helpers')
const { authToken, requirePermission, requireAnyPermission, getAuditActor, isAdminControlUser } = require('../../middleware')
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
const { createFinalBackupPackage, listBackupVersions, validateLocalBackupPackage } = require('../../services/backupPackages')
const { buildRuntimeDescriptor, bumpStorageVersion } = require('../../runtimeState')
const { startSystemJob, getSystemJob, listSystemJobs } = require('../../systemJobs')
const { analyzePostgresCutoverReadiness } = require('../../db/cutoverReadiness')
const { getDuckDbRuntimeStatus } = require('../../analytics/duckdbRuntime')
const { testObjectStore } = require('../../objectStore')
const { buildIntegrationDoctor } = require('../../services/integrationDoctor')

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
  const cutoverReadiness = analyzePostgresCutoverReadiness()
  const migrationEngineReady = cutoverReadiness.ready
  const objectStorageLive = ['r2', 'minio'].includes(OBJECT_STORAGE_DRIVER)
  const postgresLive = DATABASE_DRIVER === 'postgres' && objectStorageLive
  return {
    mode: postgresLive && migrationEngineReady ? `postgres_${OBJECT_STORAGE_DRIVER}_live` : 'migration_required',
    authoritativeData: {
      databaseDriver: DATABASE_DRIVER || 'postgres',
      databasePath: DATABASE_DRIVER === 'postgres' ? 'Postgres service: business_os/postgres' : DB_PATH,
      uploadsPath: objectStorageLive ? `${OBJECT_STORAGE_DRIVER.toUpperCase()} bucket: ${S3_BUCKET}` : UPLOADS_PATH,
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
      objectStorageConfigured: objectStorageLive,
      r2Configured: OBJECT_STORAGE_DRIVER === 'r2',
      minioConfigured: OBJECT_STORAGE_DRIVER === 'minio',
      s3EndpointConfigured: !!S3_ENDPOINT,
      s3Bucket: S3_BUCKET || null,
      analyticsEngine: ANALYTICS_ENGINE,
      parquetStore: PARQUET_STORE,
      duckdb: getDuckDbRuntimeStatus({ probe: false }),
    },
    target: {
      databaseDriver: DATABASE_DRIVER || 'postgres',
      objectStorageDriver: OBJECT_STORAGE_DRIVER || 'local',
      analyticsEngine: ANALYTICS_ENGINE || 'none',
      parquetStore: PARQUET_STORE || 'none',
      postgresAvailableForMigration: !!DATABASE_URL && DATABASE_DRIVER === 'postgres',
      objectStorageAvailableForMigration: objectStorageLive,
    },
    backupRequired: true,
    automation: getMigrationSafetyState(),
    canPrepareMigration: true,
    canRunMigration: migrationEngineReady,
    blockedReason: postgresLive && migrationEngineReady
      ? ''
      : `Postgres/${String(OBJECT_STORAGE_DRIVER || 'object storage').toUpperCase()} live mode is not fully verified. ${cutoverReadiness.blockerCount} final-runtime blockers remain or runtime drivers are not set correctly.`,
    cutoverReadiness: {
      ready: cutoverReadiness.ready,
      blockerCount: cutoverReadiness.blockerCount,
      summary: cutoverReadiness.summary,
      blockers: cutoverReadiness.blockers.slice(0, 100),
      allowedLegacyFiles: cutoverReadiness.allowedLegacyFiles,
      scannedRoot: cutoverReadiness.scannedRoot,
    },
    verification: {
      tableCounts,
      totalRows,
      queueReady,
    },
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

function readFinalBackupManifest(sourceRoot) {
  return validateLocalBackupPackage(sourceRoot)
}

function getCustomTableNames(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.name || '').trim())
    .filter((name) => name.startsWith('ct_'))
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
  const result = await createFinalBackupPackage({ destinationDir: resolvedDestination, actor, progress })
  audit(actor.userId, actor.userName, 'backup_export', 'system', null, {
    packageId: result.packageId,
    objectPrefix: result.objectPrefix,
    localPath: result.localPath,
    storageDriver: result.storageDriver,
  })
  return result
}

async function restoreFolderBackup({ sourceDir, actor = {}, progress = null } = {}) {
  const rawSource = String(sourceDir || '').trim()
  if (!rawSource) throw new Error('sourceDir is required')
  progress?.({
    phase: 'validating',
    progress: 5,
    message: 'Validating backup folder',
  })
  const snapshot = readFinalBackupManifest(rawSource)
  if (isSamePath(snapshot.root, DATA_ROOT)) {
    throw new Error('Choose a backup folder, not the current live data folder.')
  }
  progress?.({
    phase: 'validated',
    progress: 100,
    message: 'Validated final package. Confirm restore before replacing live data.',
  })
  audit(actor.userId, actor.userName, 'backup_restore_validated', 'system', null, {
    sourceDir: snapshot.root,
    backupFormat: snapshot.manifest?.format || '',
    backupCreatedAt: snapshot.manifest?.created_at || snapshot.manifest?.createdAt || '',
  })
  return {
    validated: true,
    requiresConfirmation: true,
    action: 'restore',
    sourceDir: snapshot.root,
    manifest: snapshot.manifest,
    message: 'Backup package is valid. Restore apply is intentionally gated behind confirmation so live data is not replaced by accident.',
  }
}

// ?€?€ Audit log ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
router.get('/audit-logs', authToken, requirePermission('audit_log'), (req, res) => {
  try {
    const adminUser = isAdminControlUser(req.user)
    const page = Math.max(1, parseInt(req.query?.page || '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query?.pageSize || req.query?.limit || '50', 10) || 50))
    const offset = (page - 1) * pageSize
    const params = []
    const where = []
    const action = String(req.query?.action || '').trim()
    const entity = String(req.query?.entity || '').trim()
    const search = String(req.query?.search || req.query?.q || '').trim()
    const startDate = String(req.query?.startDate || '').trim()
    const endDate = String(req.query?.endDate || '').trim()
    const userId = String(req.query?.userId || '').trim()

    if (action) { where.push('action = ?'); params.push(action) }
    if (entity) { where.push('entity = ?'); params.push(entity) }
    if (startDate) { where.push('date(created_at) >= ?'); params.push(startDate) }
    if (endDate) { where.push('date(created_at) <= ?'); params.push(endDate) }
    if (userId) {
      if (!adminUser) return err(res, 'Administrator access required for user audit filters.', 403)
      where.push('user_id = ?')
      params.push(parseInt(userId, 10) || userId)
    }
    if (search) {
      where.push(`lower(coalesce(user_name, '') || ' ' || coalesce(action, '') || ' ' || coalesce(entity, '') || ' ' || coalesce(entity_id::text, '') || ' ' || coalesce(details, '')) LIKE ?`)
      params.push(`%${search.toLowerCase()}%`)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`).get(...params)?.total || 0)
    const items = db.prepare(`
      SELECT *
      FROM audit_logs
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset)
    const users = adminUser
      ? db.prepare(`
          SELECT user_id AS id, COALESCE(NULLIF(user_name, ''), 'User ' || user_id) AS name
          FROM audit_logs
          WHERE user_id IS NOT NULL
          GROUP BY user_id, user_name
          ORDER BY name ASC
          LIMIT 500
        `).all()
      : []

    ok(res, {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: { users },
    })
  } catch (error) {
    err(res, error?.message || 'Failed to load audit logs')
  }
})

router.delete('/audit-logs/retention', authToken, requirePermission('audit_log'), (req, res) => {
  try {
    if (!isAdminControlUser(req.user)) return err(res, 'Administrator access required.', 403)
    const olderThanDays = Math.max(1, parseInt(req.query?.olderThanDays || req.body?.olderThanDays || '30', 10) || 30)
    const confirmed = req.body?.confirm === true
      || String(req.query?.confirm || '').toLowerCase() === 'true'
      || String(req.query?.confirm || '') === '1'
    if (!confirmed) return err(res, 'Confirmation is required to clear old audit logs.', 400)
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const cutoffDate = cutoff.toISOString().slice(0, 10)
    const result = db.prepare('DELETE FROM audit_logs WHERE date(created_at) < ?').run(cutoffDate)
    const actor = getAuditActor(req, req.body || {})
    audit(actor.userId, actor.userName, 'audit_log_retention_delete', 'audit_log', null, {
      olderThanDays,
      cutoffDate,
      deleted: result?.changes || 0,
    })
    ok(res, { olderThanDays, cutoffDate, deleted: result?.changes || 0 })
  } catch (error) {
    err(res, error?.message || 'Failed to clear old audit logs')
  }
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
    const clientSecret = String(existing.clientSecret || '').trim()
    if (!clientId) return err(res, 'Google OAuth client ID is required.')
    if (!clientSecret) return err(res, 'Google Drive client secret is missing from the server env. Add it to the ignored Docker env file, then restart Business OS.')

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
      const summary = await runDriveSync('manual', { progress })
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
      dedupeKey: 'google_drive_sync:manual',
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
      const summary = await runDriveSync('manual', { progress })
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
      dedupeKey: 'google_drive_sync:manual',
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

async function sendBackupVersions(req, res) {
  try {
    ok(res, { items: await listBackupVersions({ limit: req.query?.limit || 50 }) })
  } catch (error) {
    err(res, error?.message || 'Failed to list backup versions')
  }
}

router.get('/backups/versions', authToken, requirePermission('backup'), sendBackupVersions)
router.get('/backups/versions/list', authToken, requirePermission('backup'), sendBackupVersions)

router.get('/backups/:id', authToken, requirePermission('backup'), (req, res) => {
  const item = getSystemJob(req.params.id)
  if (!item) return err(res, 'Backup job not found', 404)
  ok(res, { item })
})

router.get('/object-storage/doctor', authToken, requireAnyPermission(['backup', 'settings']), async (_req, res) => {
  try {
    ok(res, { item: await testObjectStore() })
  } catch (error) {
    err(res, error?.message || 'Object storage doctor failed', 503)
  }
})

router.post('/object-storage/test-write', authToken, requireAnyPermission(['backup', 'settings']), async (_req, res) => {
  try {
    ok(res, { item: await testObjectStore() })
  } catch (error) {
    err(res, error?.message || 'Object storage test failed', 503)
  }
})

router.get('/integration-doctor', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  try {
    ok(res, {
      item: await buildIntegrationDoctor({
        driveRedirectUri: resolveDriveRedirectUri(req),
        runObjectStoreTest: req.query?.write === '1' || req.query?.deep === '1',
      }),
    })
  } catch (error) {
    err(res, error?.message || 'Integration doctor failed', 503)
  }
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
        dedupeKey: `backup_export_folder:${path.resolve(destinationDir)}`,
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
        dedupeKey: `backup_restore_folder:${path.resolve(sourceDir)}`,
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
    dedupeKey: `backup_restore_folder:${path.resolve(sourceDir)}`,
    message: 'Backup restore queued',
    runningMessage: 'Backup restore running',
    completedMessage: 'Backup restore complete',
  })
  ok(res, { job_id: job.id, item: job })
})

router.get('/backup/export', authToken, requirePermission('backup'), (req, res) => {
  err(res, 'Old single-file table downloads are not part of the final backup format. Use /api/system/backups with type export-folder.', 410)
})

router.post('/backup/export-folder', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_export_folder', max: 12, windowMs: 10 * 60 * 1000 })) return
  const destinationDir = String(req.body?.destinationDir || '').trim() || getDefaultBackupDestinationDir()

  try {
    const actor = getAuditActor(req, req.body || {})
    const job = startSystemJob('backup_export_folder', ({ progress }) => createFolderBackup({
      destinationDir,
      actor,
      progress,
    }), {
      prefix: 'backup',
      dedupeKey: `backup_export_folder:${path.resolve(destinationDir)}`,
      message: 'Backup export queued',
      runningMessage: 'Backup export running',
      completedMessage: 'Backup export complete',
    })
    return ok(res, { job_id: job.id, item: job })
  } catch (e) {
    return err(res, `Failed to queue backup: ${e.message}`)
  }
})

router.post('/backup/import', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import', max: 6, windowMs: 10 * 60 * 1000 })) return
  err(res, 'Restore accepts final backup packages only. Use /api/system/backups with type restore-folder, or run run\\docker\\restore.bat.', 410)
})

router.post('/backup/import-folder', authToken, requirePermission('backup'), async (req, res) => {
  if (!applyRouteRateLimit(req, res, { name: 'system:backup_import_folder', max: 6, windowMs: 10 * 60 * 1000 })) return
  const sourceDir = String(req.body?.sourceDir || '').trim()
  if (!sourceDir) return err(res, 'sourceDir is required')

  try {
    const actor = getAuditActor(req, req.body || {})
    const job = startSystemJob('backup_restore_folder', ({ progress }) => restoreFolderBackup({
      sourceDir,
      actor,
      progress,
    }), {
      prefix: 'restore',
      dedupeKey: `backup_restore_folder:${path.resolve(sourceDir)}`,
      message: 'Backup restore validation queued',
      runningMessage: 'Backup restore validation running',
      completedMessage: 'Backup restore validation complete',
    })
    return ok(res, { job_id: job.id, item: job })
  } catch (e) {
    return err(res, `Failed to queue restore validation: ${e.message}`)
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

router.get('/storage-mode', authToken, requireAnyPermission(['backup', 'settings']), async (req, res) => {
  try {
    const queueStatus = await initializeBullQueue()
    const status = buildScaleMigrationStatus({ ...getQueueStatus(), ...queueStatus })
    ok(res, {
      item: {
        databaseDriver: DATABASE_DRIVER || 'postgres',
        objectStorageDriver: OBJECT_STORAGE_DRIVER || 'local',
        objectStorageEndpoint: S3_ENDPOINT || null,
        objectStorageBucket: S3_BUCKET || null,
        r2Configured: OBJECT_STORAGE_DRIVER === 'r2',
        offlineMinioAvailable: OBJECT_STORAGE_DRIVER === 'minio',
        queueDriver: JOB_QUEUE_DRIVER || 'bullmq',
        cacheDriver: RUNTIME_CACHE_ENABLED ? 'redis' : 'memory',
        analyticsEngine: ANALYTICS_ENGINE || 'none',
        parquetStore: PARQUET_STORE || 'none',
        storageMode: status.mode,
        target: status.target,
        scaleServices: status.scaleServices,
        analytics: getDuckDbRuntimeStatus(),
        authoritativeData: status.authoritativeData,
        migrationState: {
          canPrepareMigration: status.canPrepareMigration,
          canRunMigration: status.canRunMigration,
          blockedReason: status.blockedReason,
          verification: status.verification,
        },
        cutoverReadiness: status.cutoverReadiness,
      },
    })
  } catch (e) {
    err(res, `Storage mode diagnostics failed: ${e.message}`)
  }
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
  return err(res, 'Postgres plus the configured object-storage adapter is the only supported runtime. Restore a final backup package if this Docker volume is missing data.', 409)
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
        : await runFsWorker('relocate-data-root', {
            sourceRoot: STORAGE_ROOT,
            targetRoot: DEFAULT_STORAGE_ROOT,
          })
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
      : await runFsWorker('relocate-data-root', {
          sourceRoot: STORAGE_ROOT,
          targetRoot: DEFAULT_STORAGE_ROOT,
        })
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





