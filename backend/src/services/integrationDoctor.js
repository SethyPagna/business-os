'use strict'

const {
  ACTIVE_ENV_FILE,
  ANALYTICS_ENGINE,
  CACHE_REDIS_URL,
  CLOUDFLARE_ADMIN_URL,
  CLOUDFLARE_PUBLIC_URL,
  DATABASE_DRIVER,
  DATABASE_URL,
  GOOGLE_DRIVE_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET,
  JOB_QUEUE_DRIVER,
  OBJECT_STORAGE_DRIVER,
  PARQUET_STORE,
  PUBLIC_BASE_URL,
  R2_PUBLIC_BASE_URL,
  REDIS_URL,
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
} = require('../config')
const { getDuckDbRuntimeStatus } = require('../analytics/duckdbRuntime')
const { getSupabaseAuthPublicConfig } = require('./supabaseAuth')
const { getDriveSyncStatus } = require('./googleDriveSync')
const { initializeBullQueue, getQueueStatus } = require('./importJobs')
const { listBackupVersions } = require('./backupPackages')
const { testObjectStore } = require('../objectStore')

function trim(value) {
  return String(value || '').trim()
}

function hasValue(value) {
  return trim(value).length > 0
}

function redactPresence(value) {
  return {
    configured: hasValue(value),
    redacted: hasValue(value) ? '[redacted]' : '',
  }
}

function status(ok, message = '') {
  return {
    ok: !!ok,
    status: ok ? 'ok' : 'needs_attention',
    message,
  }
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => trim(value)).filter(Boolean)))
}

function buildExpectedOauthChecklist(driveRedirectUri = '') {
  const appOrigins = unique([
    CLOUDFLARE_ADMIN_URL,
    CLOUDFLARE_PUBLIC_URL,
    PUBLIC_BASE_URL,
    'http://localhost:4000',
  ])
  const supabase = getSupabaseAuthPublicConfig()
  const supabaseProjectOrigin = supabase.url || ''
  const supabaseCallback = supabaseProjectOrigin ? `${supabaseProjectOrigin}/auth/v1/callback` : ''
  return {
    supabaseUrlConfiguration: {
      siteUrl: CLOUDFLARE_ADMIN_URL || PUBLIC_BASE_URL || 'http://localhost:4000',
      redirectUrls: appOrigins,
      note: 'Supabase URL Configuration should allow these Business OS origins for login and password recovery redirects.',
    },
    googleLoginClient: {
      name: 'business-os',
      authorizedJavaScriptOrigins: unique([...appOrigins, supabaseProjectOrigin]),
      authorizedRedirectUris: unique([supabaseCallback]),
      note: 'This Google OAuth client belongs to Supabase Auth / Google sign-in.',
    },
    googleDriveClient: {
      name: 'Business-os Drive',
      authorizedJavaScriptOrigins: appOrigins,
      authorizedRedirectUris: unique([
        driveRedirectUri,
        CLOUDFLARE_ADMIN_URL ? `${CLOUDFLARE_ADMIN_URL.replace(/\/$/, '')}/api/system/drive-sync/oauth/callback` : '',
        CLOUDFLARE_PUBLIC_URL ? `${CLOUDFLARE_PUBLIC_URL.replace(/\/$/, '')}/api/system/drive-sync/oauth/callback` : '',
        'http://localhost:4000/api/system/drive-sync/oauth/callback',
      ]),
      note: 'This separate Google OAuth client belongs to Business OS Google Drive backup sync.',
    },
  }
}

function probeDatabase() {
  try {
    const { db } = require('../database')
    const result = db.prepare('SELECT 1 AS ok').get()
    return status(Number(result?.ok || 0) === 1, 'Postgres query succeeded.')
  } catch (error) {
    return status(false, error?.message || 'Postgres query failed.')
  }
}

async function probeQueue() {
  try {
    const queueStatus = await initializeBullQueue()
    return {
      ...status(true, 'Redis queue initialized.'),
      driver: JOB_QUEUE_DRIVER,
      redisConfigured: hasValue(REDIS_URL),
      cacheRedisConfigured: hasValue(CACHE_REDIS_URL),
      details: { ...getQueueStatus(), ...queueStatus },
    }
  } catch (error) {
    return {
      ...status(false, error?.message || 'Redis queue initialization failed.'),
      driver: JOB_QUEUE_DRIVER,
      redisConfigured: hasValue(REDIS_URL),
      cacheRedisConfigured: hasValue(CACHE_REDIS_URL),
      details: getQueueStatus(),
    }
  }
}

async function probeBackups() {
  try {
    const versions = await listBackupVersions({ limit: 10 })
    return {
      ...status(true, 'Backup package listing succeeded.'),
      format: 'business-os-backup-vfinal',
      versions,
    }
  } catch (error) {
    return {
      ...status(false, error?.message || 'Backup package listing failed.'),
      format: 'business-os-backup-vfinal',
      versions: [],
    }
  }
}

async function buildIntegrationDoctor(options = {}) {
  const driveRedirectUri = trim(options.driveRedirectUri)
  const runObjectStoreTest = options.runObjectStoreTest === true
  const supabase = getSupabaseAuthPublicConfig()
  const drive = getDriveSyncStatus(driveRedirectUri)
  const database = probeDatabase()
  const queue = await probeQueue()
  const backup = await probeBackups()
  const analytics = getDuckDbRuntimeStatus()

  let objectStorageTest = null
  if (runObjectStoreTest) {
    try {
      objectStorageTest = await testObjectStore()
    } catch (error) {
      objectStorageTest = {
        ok: false,
        error: error?.message || 'Object storage doctor failed.',
      }
    }
  }

  const objectStorageConfigured = hasValue(S3_ENDPOINT)
    && hasValue(S3_BUCKET)
    && hasValue(S3_ACCESS_KEY_ID)
    && hasValue(S3_SECRET_ACCESS_KEY)

  const secrets = {
    envFile: ACTIVE_ENV_FILE || '',
    policy: 'Secret values are never returned by this endpoint. Rotate any key that was pasted into chat or committed by accident.',
    r2: {
      endpoint: redactPresence(S3_ENDPOINT),
      accessKeyId: redactPresence(S3_ACCESS_KEY_ID),
      secretAccessKey: redactPresence(S3_SECRET_ACCESS_KEY),
      publicBaseUrl: redactPresence(R2_PUBLIC_BASE_URL),
    },
    googleDrive: {
      clientId: redactPresence(GOOGLE_DRIVE_CLIENT_ID || drive.clientId),
      clientSecret: { configured: !!drive.hasClientSecret || hasValue(GOOGLE_DRIVE_CLIENT_SECRET), redacted: (drive.hasClientSecret || hasValue(GOOGLE_DRIVE_CLIENT_SECRET)) ? '[redacted]' : '' },
      refreshToken: { configured: !!drive.hasRefreshToken, redacted: drive.hasRefreshToken ? '[redacted]' : '' },
    },
    supabase: {
      enabled: supabase.enabled,
      url: redactPresence(supabase.url),
      anonKey: { configured: !!supabase.hasAnonKey, redacted: supabase.hasAnonKey ? '[redacted]' : '' },
      serviceRoleKey: { configured: !!supabase.hasServiceRoleKey, redacted: supabase.hasServiceRoleKey ? '[redacted]' : '' },
    },
  }

  const checks = {
    database,
    objectStorage: {
      ...status(objectStorageConfigured, objectStorageConfigured ? 'Object storage credentials are configured.' : 'Object storage endpoint, bucket, access key, and secret key are required.'),
      driver: OBJECT_STORAGE_DRIVER,
      endpoint: S3_ENDPOINT || null,
      bucket: S3_BUCKET || null,
      region: S3_REGION || null,
      publicBaseUrlConfigured: hasValue(R2_PUBLIC_BASE_URL),
      writeReadDelete: objectStorageTest,
    },
    queue,
    analytics: {
      ...status(ANALYTICS_ENGINE === 'duckdb' && PARQUET_STORE === OBJECT_STORAGE_DRIVER, 'DuckDB/Parquet runtime is configured for the active object store.'),
      engine: ANALYTICS_ENGINE,
      parquetStore: PARQUET_STORE,
      details: analytics,
    },
    googleDrive: {
      ...status(!!drive.ready, drive.ready ? 'Google Drive sync is connected.' : 'Google Drive sync is not connected yet.'),
      connected: !!drive.connected,
      enabled: !!drive.enabled,
      folderName: drive.folderName || '',
      activeVersion: drive.activeVersion || null,
      redirectUri: drive.redirectUri || driveRedirectUri,
      scope: drive.scope || '',
      lastSyncedAt: drive.lastSyncedAt || '',
      blockedReason: drive.blockedReason || '',
    },
    supabaseAuth: {
      ...status(!!supabase.enabled, supabase.enabled ? 'Supabase Auth is configured.' : 'Supabase Auth is disabled or missing required keys.'),
      enabled: !!supabase.enabled,
      googleEnabled: !!supabase.googleEnabled,
      emailAuthEnabled: !!supabase.emailAuthEnabled,
      magicLinkEnabled: !!supabase.magicLinkEnabled,
      mfaTotpEnabled: !!supabase.mfaTotpEnabled,
    },
    backup,
  }

  const criticalOk = [
    checks.database.ok,
    checks.objectStorage.ok,
    checks.queue.ok,
    checks.analytics.ok,
  ].every(Boolean)

  return {
    ok: criticalOk,
    generatedAt: new Date().toISOString(),
    runtime: {
      databaseDriver: DATABASE_DRIVER,
      databaseConfigured: hasValue(DATABASE_URL),
      objectStorageDriver: OBJECT_STORAGE_DRIVER,
      queueDriver: JOB_QUEUE_DRIVER,
      analyticsEngine: ANALYTICS_ENGINE,
      parquetStore: PARQUET_STORE,
      publicUrl: CLOUDFLARE_PUBLIC_URL || '',
      adminUrl: CLOUDFLARE_ADMIN_URL || '',
    },
    secrets,
    expectedOauth: buildExpectedOauthChecklist(driveRedirectUri),
    checks,
  }
}

module.exports = {
  buildExpectedOauthChecklist,
  buildIntegrationDoctor,
  redactPresence,
}
