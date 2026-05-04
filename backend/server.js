'use strict'

if (process.env.BUSINESS_OS_WORKER_ROLE === 'import-worker') {
  require('./src/workers/importWorker').start().catch((error) => {
    console.error(`[import-worker] failed to start: ${error?.message || error}`)
    process.exit(1)
  })
  return
}

if (process.env.BUSINESS_OS_WORKER_ROLE === 'media-worker') {
  require('./src/workers/mediaWorker').start().catch((error) => {
    console.error(`[media-worker] failed to start: ${error?.message || error}`)
    process.exit(1)
  })
  return
}

/**
 * Backend runtime entrypoint.
 *
 * Startup flow:
 * 1. Resolve config, database, middleware, and static asset locations.
 * 2. Mount security/request policy middleware that applies to every request.
 * 3. Mount health, API, transfer alias, and SPA fallback routes.
 * 4. Attach the WebSocket server to the same HTTP listener.
 * 5. Register shutdown handlers so Postgres connections close cleanly.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const { pipeline } = require('stream')
const cors = require('cors')
const express = require('express')
const { requestContextMiddleware } = require('./src/requestContext')
const { authToken, networkAccessGuard } = require('./src/middleware')
const { maintenanceWriteGuard } = require('./src/maintenanceLock')
const { db, runDatabaseMaintenance } = require('./src/database')
const { wss_clients } = require('./src/helpers')
const { getRuntimeVersion } = require('./src/runtimeVersion')
const { getDuckDbRuntimeStatus } = require('./src/analytics/duckdbRuntime')
const { getObjectStream, isObjectStorageEnabled } = require('./src/objectStore')
const { getDefaultOrganization, ensureOrganizationFilesystemLayout } = require('./src/organizationContext')
const {
  CORS_OPTIONS,
  sanitizeRequestPayload,
  isConfiguredCustomerPortalHost,
  isApiOrHealthPath,
  isSpaFallbackEligible,
  setNoStoreHeaders,
  setHtmlNoCacheHeaders,
  setTunnelSecurityHeaders,
  setFrontendStaticHeaders,
  setUploadStaticHeaders,
  mapServerError,
} = require('./src/serverUtils')
const {
  PORT,
  STORAGE_ROOT,
  DB_PATH,
  UPLOADS_PATH,
  FRONTEND_DIST,
  SYNC_TOKEN,
  DATABASE_DRIVER,
  OBJECT_STORAGE_DRIVER,
  JOB_QUEUE_DRIVER,
  RUNTIME_CACHE_ENABLED,
  ANALYTICS_ENGINE,
  PARQUET_STORE,
  S3_BUCKET,
} = require('./src/config')

const FRONTEND_DIST_EXISTS = fs.existsSync(FRONTEND_DIST)
const app = express()
let databaseMaintenanceTimer = null

function loadCompressionMiddleware() {
  // Compression is optional so the server can still boot in minimal installs.
  try {
    return require('compression')
  } catch (_) {
    return null
  }
}

function applySecurityHeaders(_req, res, next) {
  // Apply tunnel/browser hardening headers before route handlers run.
  setTunnelSecurityHeaders(_req, res)
  next()
}

function applyRequestPolicy(req, res, next) {
  // API traffic should never be cached; payloads are also sanitized here so
  // downstream route handlers receive normalized request bodies.
  if (isApiOrHealthPath(req.path)) {
    setNoStoreHeaders(res)
  }
  sanitizeRequestPayload(req)
  next()
}

function applyCoreMiddleware(target) {
  // This is the shared Express bootstrap for every request regardless of
  // whether it serves API traffic, uploads, or the SPA shell.
  const compression = loadCompressionMiddleware()
  target.disable('x-powered-by')
  target.use(cors(CORS_OPTIONS))
  target.use(applySecurityHeaders)
  if (compression) target.use(compression({ threshold: 1024 }))
  target.use(express.json({ limit: '35mb' }))
  target.use(express.urlencoded({ extended: true, limit: '10mb' }))
  target.use(applyRequestPolicy)
  target.use(requestContextMiddleware)
}

function mountStaticAssets(target) {
  // Uploads live in the configured S3-compatible object store for Docker releases.
  // when a frontend build exists.
  if (isObjectStorageEnabled()) {
    target.get('/uploads/*', async (req, res) => {
      try {
        const key = `uploads/${String(req.params[0] || '').replace(/^\/+/, '')}`
        const object = await getObjectStream(key)
        if (!object?.body) return res.status(404).type('text/plain; charset=utf-8').send('File not found')
        if (object.contentType) res.setHeader('Content-Type', object.contentType)
        if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength))
        setUploadStaticHeaders(res, key)
        pipeline(object.body, res, (error) => {
          if (error && !res.headersSent) res.status(500).end()
        })
      } catch (_) {
        res.status(404).type('text/plain; charset=utf-8').send('File not found')
      }
    })
  } else {
    fs.mkdirSync(UPLOADS_PATH, { recursive: true })
    target.use('/uploads', express.static(UPLOADS_PATH, { maxAge: '7d', setHeaders: setUploadStaticHeaders }))
  }
  if (!FRONTEND_DIST_EXISTS) return

  target.get(['/', '/index.html'], (req, res, next) => {
    if (!isConfiguredCustomerPortalHost(req)) return next()
    return res.redirect(302, '/public')
  })

  target.use(express.static(FRONTEND_DIST, {
    maxAge: 0,
    etag: true,
    setHeaders: setFrontendStaticHeaders,
  }))
}

function mountHealthRoute(target) {
  // Health checks are used by launch scripts, PM2 recovery, and the frontend
  // diagnostics page to confirm the process is alive.
  target.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      clients: wss_clients.size,
      uptime: process.uptime(),
      runtime: getRuntimeVersion(),
      drivers: {
        database: DATABASE_DRIVER,
        objectStorage: OBJECT_STORAGE_DRIVER,
        queue: JOB_QUEUE_DRIVER,
        cache: RUNTIME_CACHE_ENABLED ? 'redis' : 'memory',
        analytics: ANALYTICS_ENGINE,
        parquetStore: PARQUET_STORE,
      },
      objectStorage: {
        driver: OBJECT_STORAGE_DRIVER,
        bucket: S3_BUCKET || null,
      },
      analytics: getDuckDbRuntimeStatus(),
    })
  })
}

function mountApiRoutes(target) {
  // Keep route ownership explicit so each domain file stays responsible for a
  // bounded slice of behavior.
  const { unitsRouter } = require('./src/routes/units')

  target.use('/api', networkAccessGuard)

  target.use('/api/auth', require('./src/routes/auth'))
  target.use('/api', maintenanceWriteGuard)
  target.use('/api/organizations', require('./src/routes/organizations'))
  target.use('/api/settings', require('./src/routes/settings'))
  target.use('/api/categories', require('./src/routes/categories'))
  target.use('/api/units', unitsRouter)
  target.use('/api/branches', require('./src/routes/branches'))
  target.use('/api/products', require('./src/routes/products'))
  target.use('/api/import-jobs', require('./src/routes/importJobs'))
  target.use('/api/files', require('./src/routes/files'))
  target.use('/api/ai', require('./src/routes/ai'))
  target.use('/api/catalog', require('./src/routes/catalog'))
  target.use('/api/portal', require('./src/routes/portal'))
  target.use('/api/notifications', require('./src/routes/notifications'))
  target.use('/api/action-history', require('./src/routes/actionHistory'))
  target.use('/api/runtime', require('./src/routes/runtime'))
  target.use('/api/inventory', require('./src/routes/inventory'))
  target.use('/api/sync', require('./src/routes/sync'))
  target.use('/api', require('./src/routes/sales'))
  target.use('/api', require('./src/routes/contacts'))
  target.use('/api', require('./src/routes/users'))
  target.use('/api/custom-tables', require('./src/routes/customTables'))
  target.use('/api', require('./src/routes/returns'))
  const systemRouter = require('./src/routes/system')
  target.use('/api/backups', (req, res, next) => {
    req.url = `/backups${req.url === '/' ? '' : req.url}`
    systemRouter(req, res, next)
  })
  target.use('/api/system', systemRouter)
}

function mountTransfersAlias(target) {
  // Legacy alias consumed by inventory/branch UIs that expect transfers under
  // a dedicated collection endpoint.
  target.get('/api/transfers', authToken, (_req, res) => {
    const rows = db.prepare(`
      SELECT st.*, b1.name AS from_name, b2.name AS to_name
      FROM stock_transfers st
      LEFT JOIN branches b1 ON b1.id = st.from_branch_id
      LEFT JOIN branches b2 ON b2.id = st.to_branch_id
      ORDER BY st.created_at DESC LIMIT 500
    `).all()
    res.json(rows)
  })
}

function mountSpaFallback(target) {
  // Any non-API browser route that belongs to the React SPA should resolve to
  // index.html so client-side routing can take over.
  if (!FRONTEND_DIST_EXISTS) return

  // If an old client requests a missing built asset after a deploy, return a
  // real 404 instead of ever falling through to the SPA shell. That avoids the
  // confusing "stylesheet MIME type text/html" failure mode on stale tabs.
  target.get('/assets/*', (_req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Asset not found')
  })

  target.get('*', (req, res, next) => {
    if (!isSpaFallbackEligible(req.path)) return next()
    setHtmlNoCacheHeaders(res)
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
  })
}

function mountErrorHandler(target) {
  // Centralize API error translation so callers always receive a normalized
  // JSON shape instead of raw Express/Postgres exceptions.
  target.use((error, _req, res, next) => {
    if (!error) return next()

    const mapped = mapServerError(error)
    if (mapped.status === 500) {
      console.error('[server:error]', error?.message || error)
    }
    return res.status(mapped.status).json(mapped.body)
  })
}

function getStartupBanner() {
  // The launcher scripts and manual operators rely on this banner to confirm
  // which live drivers/frontend paths the server actually resolved.
  const frontendLine = FRONTEND_DIST_EXISTS
    ? FRONTEND_DIST
    : 'not built - run: cd frontend && npm run build'
  const databaseLine = DATABASE_DRIVER === 'postgres' ? 'Postgres service: business_os/postgres' : DB_PATH
  const uploadsLine = ['r2', 'minio'].includes(OBJECT_STORAGE_DRIVER)
    ? `${OBJECT_STORAGE_DRIVER.toUpperCase()} bucket: ${S3_BUCKET}`
    : UPLOADS_PATH

  return `
==========================================
  Business OS  |  Port ${PORT}
  Node:     ${process.version}
  Storage:  ${STORAGE_ROOT}
  DB:       ${databaseLine}
  Uploads:  ${uploadsLine}
  Token:    ${SYNC_TOKEN ? '(legacy token set)' : '(signed browser sessions)'}
  Frontend: ${frontendLine}
==========================================
  Factory-reset default login: admin / Admin123456!
`
}

function closeDatabase() {
  // Close quietly during shutdown; repeated calls should not crash the process.
  try {
    if (databaseMaintenanceTimer) clearInterval(databaseMaintenanceTimer)
    databaseMaintenanceTimer = null
    runDatabaseMaintenance({ checkpoint: 'TRUNCATE', optimize: true })
    db.close()
  } catch (_) {}
}

function startDatabaseMaintenanceTimer() {
  if (databaseMaintenanceTimer) return
  databaseMaintenanceTimer = setInterval(() => {
    runDatabaseMaintenance({ checkpoint: 'PASSIVE', optimize: true })
  }, 5 * 60 * 1000)
  databaseMaintenanceTimer.unref?.()
}

function registerShutdownHandlers() {
  // Close the pooled database client cleanly during script/container restarts.
  process.on('SIGINT', () => {
    closeDatabase()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    closeDatabase()
    process.exit(0)
  })

  process.on('exit', () => {
    closeDatabase()
  })
}

function bootstrapServer() {
  // Bootstrap order matters: middleware first, routes second, WebSocket last.
  applyCoreMiddleware(app)
  mountStaticAssets(app)
  mountHealthRoute(app)
  mountApiRoutes(app)
  mountTransfersAlias(app)
  mountSpaFallback(app)
  mountErrorHandler(app)

  try {
    const defaultOrganization = getDefaultOrganization()
    if (defaultOrganization) ensureOrganizationFilesystemLayout(defaultOrganization)
  } catch (_) {}
  try {
    const { initializeBullQueue, recoverImportJobs } = require('./src/services/importJobs')
    initializeBullQueue().catch((error) => {
      console.warn(`[import-jobs] Queue initialization skipped: ${error?.message || error}`)
    })
    recoverImportJobs().catch((error) => {
      console.warn(`[import-jobs] Recovery skipped: ${error?.message || error}`)
    })
  } catch (error) {
    console.warn(`[import-jobs] Recovery skipped: ${error?.message || error}`)
  }

  const server = http.createServer(app)
  server.requestTimeout = 60 * 1000
  server.headersTimeout = 65 * 1000
  server.keepAliveTimeout = 15 * 1000
  require('./src/websocket').attachWss(server)

  // Do not pin to IPv4 here. Cloudflare Tunnel/dashboard origins often use
  // localhost, which may resolve to ::1 first on Windows. Let Node bind the
  // unspecified address so IPv4 and IPv6 loopback origins can both connect.
  server.listen(PORT, () => {
    startDatabaseMaintenanceTimer()
    console.log(getStartupBanner())
  })

  registerShutdownHandlers()
}

bootstrapServer()
