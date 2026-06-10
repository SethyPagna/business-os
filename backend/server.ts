'use strict'

function startRequestedWorkerRole() {
  if (process.env.BUSINESS_OS_WORKER_ROLE === 'import-worker') {
    require('./src/workers/importWorker.ts').start().catch((error) => {
      console.error(`[import-worker] failed to start: ${error?.message || error}`)
      process.exit(1)
    })
    return true
  }

  if (process.env.BUSINESS_OS_WORKER_ROLE === 'media-worker') {
    require('./src/workers/mediaWorker.ts').start().catch((error) => {
      console.error(`[media-worker] failed to start: ${error?.message || error}`)
      process.exit(1)
    })
    return true
  }

  return false
}

if (!startRequestedWorkerRole()) {

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
const { requestContextMiddleware } = require('./src/requestContext.ts')
const { authToken, networkAccessGuard } = require('./src/middleware.ts')
const { getSessionUser } = require('./src/sessionAuth.ts')
const { maintenanceWriteGuard } = require('./src/maintenanceLock.ts')
const { db, runDatabaseMaintenance } = require('./src/database.ts')
const { wss_clients } = require('./src/helpers.ts')
const { getRuntimeVersion } = require('./src/runtimeVersion.ts')
const { getDuckDbRuntimeStatus } = require('./src/analytics/duckdbRuntime.ts')
const { getObjectStream, isObjectStorageEnabled } = require('./src/objectStore.ts')
const { getLegacyBatchBackfillStatus, scheduleLegacyBatchBackfill } = require('./src/productBatches.ts')
const { getDefaultOrganization, ensureOrganizationFilesystemLayout } = require('./src/organizationContext/index.ts')
const {
  CORS_OPTIONS,
  sanitizeRequestPayload,
  isConfiguredCustomerPortalHost,
  isApiOrHealthPath,
  isSpaFallbackEligible,
  setNoStoreHeaders,
  setAdminSpaHtmlHeaders,
  setTunnelSecurityHeaders,
  setFrontendStaticHeaders,
  setUploadStaticHeaders,
  mapServerError,
} = require('./src/serverUtils.ts')
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
} = require('./src/config/index.ts')

const FRONTEND_DIST_EXISTS = fs.existsSync(FRONTEND_DIST)
const app = express()
let databaseMaintenanceTimer = null
const uploadFallbackCache = new Map()
const PUBLIC_PORTAL_BOOTSTRAP_SCRIPT_ID = 'business-os-portal-bootstrap'
const ADMIN_AUTH_BOOTSTRAP_SCRIPT_ID = 'business-os-auth-bootstrap'

const LEGACY_FRONTEND_ASSET_PREFIXES = [
  'index-',
  'app-shared-',
  'app-api-',
  'POS-',
  'Inventory-',
  'catalog-editor-',
  'catalog-icons-',
  'catalog-products-',
  'catalog-public-',
  'catalog-secondary-tabs-',
  'catalog-',
  'groupedRecords-',
  'productGrouping-',
  'product-detail-',
  'Receipt-',
  'CustomersTab-',
]
const SPA_ADMIN_MODULE_PRELOAD_CHUNKS = ['app-bootstrap', 'app-auth']
const SPA_PUBLIC_MODULE_PRELOAD_CHUNKS = [
  'index',
  'vendor-react',
  'vendor',
  'app-routing',
  'PublicCatalogRoot',
  'app-portal',
  'app-shell',
  'shared-ui',
]
const SPA_ADMIN_FIRST_WINDOW_CHUNKS = [
  'AdminRoot',
  'vendor-react',
  'vendor',
  'app-routing',
  'app-api',
  'api-http-core',
  'api-http-state',
  'app-shell',
  'Sidebar',
  'shared-ui',
]
const SPA_ROUTE_MODULE_PRELOAD_CHUNKS = [
  { match: (routePath) => routePath.startsWith('/login'), chunks: ['auth-login'] },
  { match: (routePath) => routePath === '/' || routePath === '/index.html' || routePath.startsWith('/dashboard'), chunks: ['Dashboard', 'dashboard-api', 'dashboard-charts', 'app-shared', 'shared-formatters'] },
  { match: (routePath) => routePath.startsWith('/pos'), chunks: ['POS', 'product-read-api', 'product-shared', 'productDisplayHelpers', 'route-sync-utils', 'settings-refresh', 'app-api', 'shared-lazy-portal-menu', 'shared-ui'] },
  { match: (routePath) => routePath.startsWith('/products'), chunks: ['Products', 'product-read-api', 'product-shared', 'productDisplayHelpers', 'route-sync-utils', 'settings-refresh', 'app-api', 'shared-lazy-portal-menu', 'shared-ui'] },
  { match: (routePath) => routePath.startsWith('/inventory'), chunks: ['Inventory', 'inventory-api', 'product-shared', 'shared-ui'] },
  { match: (routePath) => routePath.startsWith('/sales'), chunks: ['Sales'] },
  { match: (routePath) => routePath.startsWith('/returns'), chunks: ['Returns', 'returns-read-api'] },
  { match: (routePath) => routePath.startsWith('/contacts'), chunks: ['Contacts'] },
  { match: (routePath) => routePath.startsWith('/branches'), chunks: ['Branches', 'branch-api', 'product-shared', 'shared-page-header', 'route-sync-utils', 'settings-refresh', 'app-api', 'api-local-cache', 'shared-lazy-portal-menu', 'shared-ui'] },
  { match: (routePath) => routePath.startsWith('/audit-log'), chunks: ['AuditLog', 'audit-log-api', 'refresh-cw', 'monitor-smartphone', 'route-sync-utils', 'settings-refresh', 'shared-ui', 'shared-lazy-portal-menu', 'app-shared'] },
  { match: (routePath) => routePath.startsWith('/receipt-settings'), chunks: ['ReceiptSettings'] },
  { match: (routePath) => routePath.startsWith('/backup'), chunks: ['Backup'] },
  { match: (routePath) => routePath.startsWith('/settings'), chunks: ['Settings'] },
  { match: (routePath) => routePath.startsWith('/files'), chunks: ['FilesPage', 'file-api', 'ai-api', 'multipart-headers-api', 'route-sync-utils', 'settings-refresh', 'shared-ui', 'shared-page-header', 'app-shared'] },
  { match: (routePath) => routePath.startsWith('/server'), chunks: ['ServerPage'] },
  { match: (routePath) => routePath.startsWith('/loyalty-points'), chunks: ['LoyaltyPointsPage'] },
  { match: (routePath) => routePath.startsWith('/users'), chunks: ['Users', 'user-admin-api', 'user-permission-definitions'] },
  {
    match: (routePath) => routePath.startsWith('/public') || routePath.startsWith('/customer-portal'),
    chunks: [
      'index',
      'vendor-react',
      'vendor',
      'app-routing',
      'PublicCatalogRoot',
      'app-portal',
      'app-shell',
      'shared-ui',
      'shared-lazy-portal-menu',
      'catalog-public-core',
      'catalog-public-utils',
      'catalog-public',
      'catalog-icons',
      'catalog-products',
      'route-sync-utils',
    ],
  },
]
const FRONTEND_CHUNK_BASE_COLLISIONS = {
  'app-api': ['methods'],
  vendor: ['dexie', 'react', 'zxing'],
  catalog: ['context', 'display', 'editor', 'icons', 'preview', 'products', 'public', 'secondary-tabs', 'ui'],
  'catalog-public': ['core', 'utils'],
}
const frontendModulePreloadCache = new Map()
const frontendStylePreloadCache = { value: null }
const frontendPublicFontPreloadCache = { value: null }

function listFrontendAssetFiles() {
  if (!FRONTEND_DIST_EXISTS) return []
  const assetsDir = path.join(FRONTEND_DIST, 'assets')
  try {
    return fs.readdirSync(assetsDir)
  } catch (_) {
    return []
  }
}

function resolveFrontendAssetPath(assetName = '') {
  if (!FRONTEND_DIST_EXISTS) return ''
  const normalized = String(assetName || '').replace(/^\/+/, '')
  if (!normalized) return ''
  const assetsDir = path.join(FRONTEND_DIST, 'assets')
  const directPath = path.join(assetsDir, normalized)
  if (fs.existsSync(directPath)) return directPath
  if (!normalized.endsWith('.js')) return ''

  const legacyPrefixes = [...LEGACY_FRONTEND_ASSET_PREFIXES].sort((a, b) => b.length - a.length)
  for (const prefix of legacyPrefixes) {
    if (!normalized.startsWith(prefix)) continue
    const fallbackName = resolveFrontendChunkAssetName(prefix.replace(/-$/, ''))
    if (!fallbackName) return ''
    const fallbackPath = path.join(assetsDir, fallbackName)
    return fs.existsSync(fallbackPath) ? fallbackPath : ''
  }

  return ''
}

function resolveFrontendChunkAssetName(chunkBase = '') {
  if (!FRONTEND_DIST_EXISTS) return ''
  const normalized = String(chunkBase || '').trim()
  if (!normalized) return ''
  if (frontendModulePreloadCache.has(normalized)) {
    return frontendModulePreloadCache.get(normalized)
  }

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exactChunkPattern = new RegExp(`^${escaped}-[A-Za-z0-9_-]+\\.js$`)
  const collisionPattern = FRONTEND_CHUNK_BASE_COLLISIONS[normalized]
    ? new RegExp(`^${escaped}-(${FRONTEND_CHUNK_BASE_COLLISIONS[normalized].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-`)
    : null
  const assetsDir = path.join(FRONTEND_DIST, 'assets')
  const assetName = listFrontendAssetFiles()
    .filter((name) => exactChunkPattern.test(name) && !(collisionPattern && collisionPattern.test(name)))
    .map((name) => {
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(path.join(assetsDir, name)).mtimeMs || 0
      } catch (_) {}
      return { name, mtimeMs }
    })
    .sort((left, right) => (left.mtimeMs - right.mtimeMs) || left.name.localeCompare(right.name))
    .at(-1)?.name || ''
  frontendModulePreloadCache.set(normalized, assetName)
  return assetName
}

function getSpaModulePreloadChunks(routePath = '/') {
  const normalizedPath = String(routePath || '/').split('?')[0] || '/'
  const isPublicPortalRoute = normalizedPath.startsWith('/public') || normalizedPath.startsWith('/customer-portal')
  const routeChunks = SPA_ROUTE_MODULE_PRELOAD_CHUNKS
    .filter((entry) => entry.match(normalizedPath))
    .flatMap((entry) => entry.chunks)
  const baseChunks = isPublicPortalRoute
    ? SPA_PUBLIC_MODULE_PRELOAD_CHUNKS
    : [...SPA_ADMIN_MODULE_PRELOAD_CHUNKS, ...SPA_ADMIN_FIRST_WINDOW_CHUNKS]
  return [...new Set([...baseChunks, ...routeChunks])]
}

function appendLinkHeader(res, value) {
  if (typeof res.append === 'function') {
    res.append('Link', value)
    return
  }
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Link') : ''
  const nextValue = existing ? `${existing}, ${value}` : value
  res.setHeader('Link', nextValue)
}

function appendSpaModulePreloadHeaders(req, res) {
  const routePath = req?.path || '/'
  for (const chunkBase of getSpaModulePreloadChunks(routePath)) {
    const assetName = resolveFrontendChunkAssetName(chunkBase)
    if (!assetName) continue
    appendLinkHeader(res, `</assets/${assetName}>; rel=modulepreload; fetchpriority=high`)
  }
}

function resolveFrontendStyleAssetNames() {
  if (!FRONTEND_DIST_EXISTS) return []
  if (frontendStylePreloadCache.value) return frontendStylePreloadCache.value
  const assetsDir = path.join(FRONTEND_DIST, 'assets')
  frontendStylePreloadCache.value = listFrontendAssetFiles()
    .filter((name) => name.endsWith('.css'))
    .map((name) => {
      let size = 0
      try {
        size = fs.statSync(path.join(assetsDir, name)).size || 0
      } catch (_) {}
      return { name, size }
    })
    .sort((left, right) => left.size - right.size || left.name.localeCompare(right.name))
    .map((entry) => entry.name)
  return frontendStylePreloadCache.value
}

function appendSpaStylePreloadHeaders(res) {
  for (const assetName of resolveFrontendStyleAssetNames()) {
    if (/^(index|vendor)-/.test(assetName)) continue
    appendLinkHeader(res, `</assets/${assetName}>; rel=preload; as=style; crossorigin`)
  }
}

function resolveFrontendPublicFontPreloadAssetNames() {
  if (!FRONTEND_DIST_EXISTS) return []
  if (frontendPublicFontPreloadCache.value) return frontendPublicFontPreloadCache.value
  frontendPublicFontPreloadCache.value = listFrontendAssetFiles()
    .filter((name) => /^noto-sans-khmer-khmer-600-normal-[A-Za-z0-9_-]+\.woff2$/.test(name))
    .sort()
    .slice(0, 1)
  return frontendPublicFontPreloadCache.value
}

function appendPublicFontPreloadHeaders(res) {
  for (const assetName of resolveFrontendPublicFontPreloadAssetNames()) {
    appendLinkHeader(res, `</assets/${assetName}>; rel=preload; as=font; type=font/woff2; crossorigin`)
  }
}

function setPublicSpaHtmlCacheHeaders(res, refreshSeconds = 20) {
  const ttlSeconds = Math.max(5, Math.min(60, Number(refreshSeconds) || 20))
  res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=120`)
  if (typeof res.removeHeader === 'function') {
    res.removeHeader('Pragma')
    res.removeHeader('Expires')
  }
}

function isPublicSpaRoutePath(routePath = '/') {
  const normalizedPath = String(routePath || '/').split('?')[0].toLowerCase() || '/'
  return normalizedPath.startsWith('/public') || normalizedPath.startsWith('/customer-portal')
}

function escapeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function injectPublicPortalBootstrap(html, payload) {
  if (!html || html.includes(`id="${PUBLIC_PORTAL_BOOTSTRAP_SCRIPT_ID}"`)) return html
  const script = `<script type="application/json" id="${PUBLIC_PORTAL_BOOTSTRAP_SCRIPT_ID}">${escapeInlineJson(payload)}</script>`
  return html.includes('</head>')
    ? html.replace('</head>', `${script}\n </head>`)
    : `${html}\n${script}`
}

function injectAdminAuthBootstrap(html, payload) {
  if (!html || !payload || html.includes(`id="${ADMIN_AUTH_BOOTSTRAP_SCRIPT_ID}"`)) return html
  const script = `<script type="application/json" id="${ADMIN_AUTH_BOOTSTRAP_SCRIPT_ID}">${escapeInlineJson(payload)}</script>`
  if (html.includes('<script data-business-os-route-preloads>')) {
    return html.replace('<script data-business-os-route-preloads>', `${script}\n    <script data-business-os-route-preloads>`)
  }
  return html.includes('</head>')
    ? html.replace('</head>', `${script}\n </head>`)
    : `${html}\n${script}`
}

async function sendPublicSpaIndex(_req, res) {
  const htmlPath = path.join(FRONTEND_DIST, 'index.html')
  const portalRouter = require('./src/routes/portal.ts')
  const buildPayload = portalRouter?.buildPublicPortalBootstrapPayload
  if (typeof buildPayload !== 'function') {
    return res.sendFile(htmlPath)
  }
  const html = await fs.promises.readFile(htmlPath, 'utf8')
  const payload = await buildPayload()
  setPublicSpaHtmlCacheHeaders(res, payload?.config?.refreshSeconds)
  res.type('html')
  return res.send(injectPublicPortalBootstrap(html, payload))
}

async function sendAdminSpaIndex(req, res) {
  const htmlPath = path.join(FRONTEND_DIST, 'index.html')
  const sessionUser = getSessionUser(req)
  if (!sessionUser?.id) return res.sendFile(htmlPath)

  try {
    req.user = req.user || sessionUser
    const authRouter = require('./src/routes/auth.ts')
    const buildPayload = authRouter?.buildAuthenticatedBootstrap
    if (typeof buildPayload !== 'function') return res.sendFile(htmlPath)
    const payload = await buildPayload(req, sessionUser.id)
    if (!payload) return res.sendFile(htmlPath)
    const html = await fs.promises.readFile(htmlPath, 'utf8')
    res.type('html')
    return res.send(injectAdminAuthBootstrap(html, payload))
  } catch (error) {
    console.warn(`[server] admin auth inline bootstrap unavailable: ${error?.message || error}`)
    return res.sendFile(htmlPath)
  }
}

function sendSpaIndex(req, res, _next) {
  setAdminSpaHtmlHeaders(req, res)
  if (isPublicSpaRoutePath(req?.path)) {
    appendSpaStylePreloadHeaders(res)
    appendPublicFontPreloadHeaders(res)
  }
  appendSpaModulePreloadHeaders(req, res)
  if (isPublicSpaRoutePath(req?.path)) {
    return sendPublicSpaIndex(req, res).catch((error) => {
      console.warn(`[server] public portal inline bootstrap unavailable: ${error?.message || error}`)
      return res.sendFile(path.join(FRONTEND_DIST, 'index.html'))
    })
  }
  return sendAdminSpaIndex(req, res)
}

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

function normalizeUploadFileName(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || ''
}

function getSafeActiveUploadPath(fileName = '') {
  const safeName = normalizeUploadFileName(fileName)
  if (!safeName) return ''
  const absolutePath = path.resolve(UPLOADS_PATH, safeName)
  const uploadsRoot = path.resolve(UPLOADS_PATH)
  if (absolutePath !== uploadsRoot && absolutePath.startsWith(`${uploadsRoot}${path.sep}`)) return absolutePath
  return ''
}

function findBackupUploadFallback(fileName = '') {
  const safeName = normalizeUploadFileName(fileName)
  if (!safeName) return ''
  const cached = uploadFallbackCache.get(safeName)
  if (cached && fs.existsSync(cached)) return cached
  const backupRoots = Array.from(new Set([
    path.join(path.dirname(UPLOADS_PATH), 'backups'),
    path.join(STORAGE_ROOT, 'backups'),
  ]))
  let best = { path: '', size: -1, mtimeMs: 0 }
  for (const backupRoot of backupRoots) {
    if (!fs.existsSync(backupRoot)) continue
    let entries = []
    try {
      entries = fs.readdirSync(backupRoot, { withFileTypes: true })
    } catch (_) {
      continue
    }
    const backupDirs = entries
      .filter((entry) => entry.isDirectory() && /^datasync-/i.test(entry.name))
      .map((entry) => {
        const absolutePath = path.join(backupRoot, entry.name)
        try {
          return { entry, mtimeMs: fs.statSync(absolutePath).mtimeMs || 0 }
        } catch (_) {
          return { entry, mtimeMs: 0 }
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 80)
    for (const { entry } of backupDirs) {
      if (!entry.isDirectory() || !/^datasync-/i.test(entry.name)) continue
      const candidate = path.join(backupRoot, entry.name, 'objects', 'uploads', safeName)
      try {
        const stats = fs.statSync(candidate)
        if (!stats.isFile()) continue
        if (stats.size > best.size || (stats.size === best.size && stats.mtimeMs > best.mtimeMs)) {
          best = { path: candidate, size: stats.size, mtimeMs: stats.mtimeMs }
        }
      } catch (_) {}
    }
  }
  if (best.path) uploadFallbackCache.set(safeName, best.path)
  return best.path
}

function inferUploadContentType(fileName = '') {
  const ext = path.extname(String(fileName || '').toLowerCase())
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.pdf') return 'application/pdf'
  return 'application/octet-stream'
}

function serveLocalUpload(req, res, fileName = '', sourcePath = '') {
  const safeName = normalizeUploadFileName(fileName)
  const absolutePath = sourcePath || getSafeActiveUploadPath(safeName)
  if (!safeName || !absolutePath || !fs.existsSync(absolutePath)) return false
  setUploadStaticHeaders(res, absolutePath)
  res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
  if (req.method === 'HEAD') {
    const stats = fs.statSync(absolutePath)
    res.setHeader('Content-Type', inferUploadContentType(safeName))
    res.setHeader('Content-Length', String(stats.size))
    res.status(200).end()
    return true
  }
  res.sendFile(absolutePath)
  return true
}

async function getObjectStreamWithTimeout(key, timeoutMs = 2500) {
  let timer = null
  try {
    return await Promise.race([
      getObjectStream(key),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Object storage read timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function mountStaticAssets(target) {
  // Uploads live in the configured S3-compatible object store for Docker releases.
  // when a frontend build exists.
  if (isObjectStorageEnabled()) {
    target.get('/uploads/*', async (req, res) => {
      const fileName = normalizeUploadFileName(req.params[0] || '')
      const activePath = getSafeActiveUploadPath(fileName)
      if (serveLocalUpload(req, res, fileName, activePath)) return
      const backupPath = findBackupUploadFallback(fileName)
      if (backupPath) {
        try {
          fs.mkdirSync(UPLOADS_PATH, { recursive: true })
          if (activePath && !fs.existsSync(activePath)) fs.copyFileSync(backupPath, activePath)
        } catch (_) {}
        if (serveLocalUpload(req, res, fileName, fs.existsSync(activePath) ? activePath : backupPath)) return
      }
      try {
        const key = `uploads/${fileName}`
        const object = await getObjectStreamWithTimeout(key)
        if (!object?.body) return res.status(404).type('text/plain; charset=utf-8').send('File not found')
        if (object.contentType) res.setHeader('Content-Type', object.contentType)
        if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength))
        setUploadStaticHeaders(res, key)
        if (req.method === 'HEAD') return res.status(200).end()
        pipeline(object.body, res, (error) => {
          if (error && !res.headersSent) res.status(500).end()
        })
      } catch (_) {
        const fallbackPath = findBackupUploadFallback(fileName)
        if (fallbackPath) {
          try {
            fs.mkdirSync(UPLOADS_PATH, { recursive: true })
            if (activePath && !fs.existsSync(activePath)) fs.copyFileSync(fallbackPath, activePath)
          } catch (_) {}
          if (serveLocalUpload(req, res, fileName, fs.existsSync(activePath) ? activePath : fallbackPath)) return
        }
        res.status(404).type('text/plain; charset=utf-8').send('File not found')
      }
    })
  } else {
    fs.mkdirSync(UPLOADS_PATH, { recursive: true })
    target.use('/uploads', express.static(UPLOADS_PATH, { maxAge: '7d', setHeaders: setUploadStaticHeaders }))
  }
  if (!FRONTEND_DIST_EXISTS) return

  target.get(['/', '/index.html'], (req, res, next) => {
    if (isConfiguredCustomerPortalHost(req)) {
      setNoStoreHeaders(res)
      return res.redirect(302, '/public')
    }
    return sendSpaIndex(req, res, next)
  })

  target.get('/assets/:assetName', (req, res, next) => {
    const assetPath = resolveFrontendAssetPath(req.params.assetName)
    if (!assetPath) return next()
    setFrontendStaticHeaders(res, assetPath)
    return res.sendFile(assetPath)
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
      batches: {
        legacyBackfill: getLegacyBatchBackfillStatus(),
      },
    })
  })
}

function mountApiRoutes(target) {
  // Keep route ownership explicit so each domain file stays responsible for a
  // bounded slice of behavior.
  const { unitsRouter } = require('./src/routes/units.ts')

  target.use('/api', networkAccessGuard)

  target.use('/api/auth', require('./src/routes/auth.ts'))
  target.use('/api', maintenanceWriteGuard)
  target.use('/api/organizations', require('./src/routes/organizations.ts'))
  target.use('/api/settings', require('./src/routes/settings.ts'))
  target.use('/api/categories', require('./src/routes/categories.ts'))
  target.use('/api/units', unitsRouter)
  target.use('/api/branches', require('./src/routes/branches.ts'))
  target.use('/api/products', require('./src/routes/products.ts'))
  target.use('/api/import-jobs', require('./src/routes/importJobs.ts'))
  target.use('/api/files', require('./src/routes/files.ts'))
  target.use('/api/ai', require('./src/routes/ai.ts'))
  target.use('/api/catalog', require('./src/routes/catalog.ts'))
  target.use('/api/portal', require('./src/routes/portal.ts'))
  target.use('/api/notifications', require('./src/routes/notifications.ts'))
  target.use('/api/action-history', require('./src/routes/actionHistory.ts'))
  target.use('/api/runtime', require('./src/routes/runtime.ts'))
  target.use('/api/inventory', require('./src/routes/inventory.ts'))
  target.use('/api/sync', require('./src/routes/sync.ts'))
  target.use('/api', require('./src/routes/sales.ts'))
  target.use('/api', require('./src/routes/contacts.ts'))
  target.use('/api', require('./src/routes/users.ts'))
  target.use('/api/custom-tables', require('./src/routes/customTables.ts'))
  target.use('/api', require('./src/routes/returns.ts'))
  const systemRouter = require('./src/routes/system/index.ts')
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
    return sendSpaIndex(req, res, next)
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
    scheduleLegacyBatchBackfill()
  } catch (error) {
    console.warn(`[product-batches] background backfill skipped: ${error?.message || error}`)
  }
  try {
    const { prewarmFileAssetListing } = require('./src/fileAssets.ts')
    setImmediate(() => {
      prewarmFileAssetListing().catch((error) => {
        console.warn(`[file-assets] prewarm skipped: ${error?.message || error}`)
      })
    })
  } catch (error) {
    console.warn(`[file-assets] prewarm skipped: ${error?.message || error}`)
  }
  try {
    const { initializeBullQueue, recoverImportJobs } = require('./src/services/importJobs.ts')
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
  require('./src/websocket.ts').attachWss(server)

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
}
