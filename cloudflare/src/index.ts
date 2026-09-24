import { Hono, type Context } from 'hono'
import settingsRoute from './routes/settings'
import productsRoute from './routes/products'
import productCostRoute from './routes/productCost'
import portalRoute from './routes/portal'
import salesRoute from './routes/sales'
import authRoute from './routes/auth'
import filesRoute from './routes/files'
import branchesRoute from './routes/branches'
import promotionsRoute from './routes/promotions'
import backupsRoute from './routes/backups'
import lookupsRoute from './routes/lookups'
import contactsRoute from './routes/contacts'
import inventoryRoute from './routes/inventory'
import stockInCommitRoute from './routes/stockInCommit'
import compatRoute from './routes/compat'
import aiRoute from './routes/ai'
import importJobsRoute from './routes/importJobs'
import returnsRoute from './routes/returns'
import systemRoute from './routes/system'
import notificationsRoute from './routes/notifications'
import organizationsRoute from './routes/organizations'
import actionHistoryRoute from './routes/actionHistory'
import runtimeRoute from './routes/runtime'
import usersRoute from './routes/users'
import devicesRoute from './routes/devices'
import notesRoute from './routes/notes'
import batchesRoute from './routes/batches'
import shiftsRoute from './routes/shifts'
import feesRoute from './routes/fees'
import reportsRoute from './routes/reports'
import telegramRoute from './routes/telegram'
import reviewQueueRoute from './routes/reviewQueue'
import posRoute from './routes/pos'
import { createSyncRoute } from './routes/sync'
import { getSessionUser } from './lib/auth'
import { hasPermission, isAdminControlUser } from './lib/permissions'
import { admitRequestBody, SMALL_BODY_BYTES, MIGRATION_FINALIZE_BODY_BYTES, smallBodyAccess } from './lib/requestBodyGuard'
import { ensureCoreDataInvariantsOnce } from './lib/coreDataInvariants'
import { getMaintenance, isMaintenanceGatedRequest } from './lib/maintenance'
import { reportError } from './lib/errorReporting'
import { serveObject } from './lib/r2'
import { handleImportQueue, handleImportDeadLetterQueue, handleMediaQueue, handleBackupQueue } from './queue'
import { deliverTelegramShiftOverview, drainDueTelegramShiftOverviews, isShiftOverviewQueueMessage } from './lib/telegram'
import { maybeRunScheduledBackup } from './lib/backup'
import { driveSyncScheduleDue } from './lib/googleDrive'
import { enqueueDriveSyncJob } from './lib/driveSyncQueue'
import { maybeRunScheduledAuditLogRetention } from './lib/audit'
import { maybeRunScheduledImportRetention, cleanOrphanImportStaging } from './lib/importRetention'
import { maybeRunScheduledImageAudit } from './lib/imageAudit'
import { maybeRunScheduledEphemeralRetention } from './lib/ephemeralRetention'
import { reapStalledImportJobs } from './routes/importJobs'
import { ReportMoneyPrecisionError, reportMoneyHttpError } from './lib/reportMoneyPrecision'
import { ADMIN_DOCUMENT_REWRITES, APP_DOCUMENT_ROUTES, shouldRewriteAdminDocument } from './lib/adminDocumentIdentity'
import { robotsTxt, sitemapXml } from './lib/publicSeo'

export type Env = {
  DB: D1Database
  // Optional second D1 holding ONLY the bulk import STAGING tables
  // (import_job_rows, import_job_source_rows) -- see lib/db.ts's D1Compat
  // .staging field. When bound (production), getDb(env).staging points here so
  // the hundreds of MB of regenerable per-row import staging never bloat the
  // operational DB; when absent (local dev, tests, any single-DB deployment),
  // staging transparently falls back to DB and behaviour is unchanged. Same
  // optional-binding-with-fallback pattern as BACKUP_QUEUE below.
  IMPORT_DB?: D1Database
  ASSETS: R2Bucket
  // The Workers static-asset binding (wrangler.toml [assets]) -- the built
  // frontend. Distinct from ASSETS above, which is the R2 bucket holding
  // UPLOADED files. Optional so a deployment or test harness without the
  // binding degrades to an explicit 503 on document routes instead of
  // failing to type-check the whole Worker.
  STATIC_ASSETS?: Fetcher
  CACHE: KVNamespace
  // Sentry DSN. Optional: absent means reporting is simply skipped, so a
  // local or misconfigured environment behaves exactly as before rather
  // than failing. Set in wrangler.toml [vars] -- a DSN is a public
  // ingest key by design, not a secret.
  SENTRY_DSN?: string
  // Analytics Engine. Optional: absent means recordAnalytics is a no-op, so
  // a local run behaves exactly as it did before the binding existed.
  Business_OS_Analytics?: AnalyticsEngineDataset
  // Cloudflare Images binding. Optional so a local run or a deploy predating
  // the binding degrades to "no server-side transform available" rather than
  // throwing -- lib/imagePipeline.ts falls through to the next provider.
  IMAGES?: ImagesBinding
  // Cloudinary, used only as the fallback once Cloudflare Images' monthly
  // transformations are spent. Absent means that rung of the ladder is
  // skipped -- see lib/imagePipeline.ts.
  CLOUDINARY_CLOUD_NAME?: string
  // Signed uploads: the secret lives in `wrangler secret`, never in [vars],
  // and nothing publicly writable is created on the Cloudinary side.
  CLOUDINARY_API_KEY?: string
  CLOUDINARY_API_SECRET?: string
  // Optional so the type tells the truth: a deployment whose config lost its
  // [[queues.producers]] block still runs, it just has no binding here. The
  // producers no longer touch these directly -- import work goes through
  // lib/queueDispatch.ts (queued when bound, inline when not) and image
  // normalization through lib/imageAudit.ts, which already checked.
  IMPORT_QUEUE?: Queue
  MEDIA_QUEUE?: Queue
  // Optional (wrangler.toml [[queues.producers]] binding) -- see
  // lib/backup.ts's createCloudflareBackup/continueCloudflareBackupAssetCopy
  // for the queue-driven full-asset-coverage backup path (Part 122).
  // Optional because the underlying Cloudflare queue has to be created
  // once by the account owner (`wrangler queues create
  // business-os-backup-assets`, see wrangler.toml's comment on that
  // consumer) before it can be bound -- accounts that haven't done that
  // yet fall back to createCloudflareBackup's pre-existing rotating-cursor
  // behavior instead of failing.
  BACKUP_QUEUE?: Queue
  SYNC_UPLOADS: DurableObjectNamespace
  BROADCAST_HUB: DurableObjectNamespace
  BUSINESS_OS_PUBLIC_URL: string
  BUSINESS_OS_ADMIN_URL: string
  // Which Workers plan this deployment runs on: 'paid' (wrangler.toml) or
  // 'free' (wrangler.free.toml). Read ONLY by lib/planTier.ts, which turns
  // it into the limit table every plan-sensitive call site reads. Optional
  // and defaulting to 'paid' on purpose -- see that module's header for why
  // an unset value must never be treated as 'free', and why the tier is
  // never inferred from which bindings happen to be present.
  PLAN_TIER?: 'free' | 'paid'
  // Slug (or public_id) of the one organization this deployment serves --
  // see routes/organizations.ts's getDefaultOrganization for why this is a
  // preference with a fallback rather than a hard requirement. Optional:
  // unset behaves exactly as before.
  BUSINESS_OS_ORGANIZATION_SLUG?: string
  // Display name for that same organization. Read by
  // lib/coreDataInvariants.ts, which used to hardcode 'Business OS' and
  // rewrite it on every run -- so renaming the org in the database was
  // silently undone. Optional: unset keeps the historical default.
  BUSINESS_OS_ORGANIZATION_NAME?: string
  // Optional secret (wrangler secret put APP_ENCRYPTION_KEY) used to encrypt
  // AI provider API keys at rest. See cloudflare/src/lib/secretCrypto.ts --
  // without it, keys are stored in plaintext, matching how the Node backend
  // behaves when process.env.APP_ENCRYPTION_KEY is unset.
  APP_ENCRYPTION_KEY?: string
  // Optional secret + var (wrangler secret put RESEND_API_KEY / a
  // RESEND_FROM_EMAIL var in wrangler.toml) used by lib/verification.ts to
  // email password-reset codes via Resend. Without both set, reset codes
  // are generated and stored but never actually emailed -- see
  // lib/verification.ts's sendCodeEmail() for the exact fallback behavior.
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
  // Telegram's bot API token. It is intentionally a Worker secret, never a
  // setting: chat IDs may be configured by an admin, but a bot token grants
  // control of the bot and must never be returned to the browser.
  TELEGRAM_BOT_TOKEN?: string
  // Google identity login (Sign in with Google) -- see lib/googleOauth.ts.
  // CLIENT_ID/REDIRECT_URI are plain vars (not secret); CLIENT_SECRET should
  // be set with `wrangler secret put GOOGLE_LOGIN_CLIENT_SECRET` in
  // production, but is accepted as a [vars] entry too since this
  // deployment's owner has opted to keep it alongside the others.
  GOOGLE_LOGIN_CLIENT_ID?: string
  GOOGLE_LOGIN_CLIENT_SECRET?: string
  GOOGLE_LOGIN_REDIRECT_URI?: string
  // HMAC secret for signing the Google OAuth `state` param. Falls back to
  // GOOGLE_LOGIN_CLIENT_SECRET if unset (see lib/googleOauth.ts).
  AUTH_SESSION_SECRET?: string
  // Google Drive OAuth (backup mirror) -- see lib/googleDrive.ts. Separate
  // OAuth client from the login one above, matching the legacy backend's
  // own separation of "sign-in with Google" vs "Drive sync" credentials.
  GOOGLE_DRIVE_CLIENT_ID?: string
  GOOGLE_DRIVE_CLIENT_SECRET?: string
  GOOGLE_DRIVE_REDIRECT_URI?: string
}

const app = new Hono<{ Bindings: Env }>()

// Global safety net: most routes in this Worker (compat.ts, auth.ts, etc.)
// have no per-route try/catch. Without this, Hono's default behavior for
// any uncaught exception is to return the literal plain-text body
// "Internal Server Error" with status 500 -- which is exactly the string
// that was showing up verbatim in the frontend's "Write failed" toasts.
// This doesn't fix the underlying transient failures (see the retry added
// in lib/db.ts for that), but it guarantees every route -- including any
// added later without its own try/catch -- returns a consistent JSON body
// the frontend can actually parse and show a sane message for, instead of
// a bare string.
app.onError((error, c) => {
  if (error instanceof ReportMoneyPrecisionError) {
    const mapped = reportMoneyHttpError(error)
    return c.json({
      success: false,
      error: mapped.message,
      code: error.code,
    }, mapped.status)
  }
  console.error('[worker] unhandled error', c.req.method, c.req.path, error)
  // Reported through waitUntil, never awaited: the response must not wait on
  // a third-party POST, and on the free plan's 10ms CPU budget it must not
  // consume the request's own allowance. reportError never throws, so this
  // cannot turn one failure into two -- see lib/errorReporting.ts.
  //
  // c.req.path, not the full URL: a URL carries the query string, which is
  // where search terms and membership lookups live.
  c.executionCtx?.waitUntil(reportError(c.env.SENTRY_DSN, error, {
    source: 'worker',
    location: c.req.path,
    method: c.req.method,
    // No release/role here on purpose: this handler's Hono context has no
    // typed Variables, so `user` is genuinely unavailable at this point,
    // and there is no build-revision var to read. Reporting a real null
    // beats inventing a field that would silently always be empty.
    release: null,
    role: null,
  }))
  return c.json({
    success: false,
    error: 'Something went wrong processing that request. Please try again.',
  }, 500)
})

// Baseline security headers on every response. Previously none of these
// were set at all -- the app relied entirely on Cloudflare's own edge
// defaults. These are conservative (won't break the SPA/API split this
// Worker serves) rather than a maximally strict CSP, since a wrong CSP
// directive here would silently break the admin app or public portal in
// production with no easy local repro:
// - X-Content-Type-Options: stops browsers from MIME-sniffing an
//   uploaded/served asset into executing as something it isn't.
// - Referrer-Policy: avoids leaking full internal URLs (which can contain
//   membership numbers, org paths) to third-party origins on outbound
//   links/images.
// - Permissions-Policy: opts out of browser features this app never
//   needs, at zero functional cost -- EXCEPT camera, which stays allowed
//   for same-origin use only (`self`). This app's barcode/RFID scanning
//   flow (scanbotScanner.ts, BarcodeScannerModal.tsx, cameraPermission.ts)
//   genuinely calls getUserMedia for the camera; blocking it here would
//   have silently broken that feature in production with no console error
//   pointing at this file.
// - Strict-Transport-Security: Cloudflare already terminates TLS and this
//   app has no non-HTTPS routes, so HSTS is a safe, standard addition.
// - X-Frame-Options is deliberately NOT set to DENY/SAMEORIGIN here for
//   the admin app: `/uploads/*` also serves through this Worker and other
//   deployments occasionally need to preview an uploaded receipt/image in
//   a modal iframe from the same origin, which SAMEORIGIN would already
//   allow anyway -- so it's set to SAMEORIGIN rather than left unset,
//   which is the safe middle ground (blocks third-party framing/
//   clickjacking, doesn't block the app's own same-origin usage).
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'SAMEORIGIN')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=(), usb=()')
  c.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
})

// G4: the app document itself, for the SPA routes wrangler.toml's
// run_worker_first sends here.
//
// One built index.html serves both hosts with a storefront-first <head> and
// an inline script that swaps in the admin identity before first paint. On
// iOS that script is not always early enough: Add to Home Screen can read the
// raw HTML, so installing the ADMIN app could produce a home-screen icon
// called Leang Beauty pointing at the storefront manifest. Rewriting the tags
// here means the bytes iOS reads are already correct, on every SPA route
// someone can be sitting on when they install, without touching index.html or
// the storefront host.
//
// Registered ABOVE the body-guard/seeding middleware on purpose: a static
// document must not carry a D1 bootstrap, and Hono runs matched handlers in
// registration order, so this terminal handler keeps the security headers set
// above and skips everything below. Anything it cannot rewrite -- a 304, a
// non-HTML response, the storefront host -- is passed through untouched.
const APP_DOCUMENT_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

async function serveAppDocument(c: Context<{ Bindings: Env }>): Promise<Response> {
  const assets = c.env.STATIC_ASSETS
  // Only reachable if run_worker_first routes a document here on a deployment
  // whose [assets] block has no binding; say so instead of serving a 404 page.
  if (!assets) return c.text('Static assets are not bound to this Worker deployment.', 503)

  let response = await assets.fetch(c.req.raw)
  // Workers Assets normalises an app document with a redirect of its own:
  // /index.html answers 301 -> / (html_handling). Passing that redirect
  // through is what blanked the app on Sep 17. The service worker
  // precaches /index.html, the Cache API stores the response with its
  // `redirected` flag set, and serving a redirected response to a
  // NAVIGATION request is a network error by spec -- the owner saw "the
  // response served by the service worker has redirections" and a blank
  // page that survived every reload, because the poison was in the cache.
  // Following it here means no client can store a redirected app document
  // in the first place. One hop only, same origin only.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    const origin = new URL(c.req.url).origin
    const target = location ? new URL(location, c.req.url) : null
    if (target && target.origin === origin) {
      response = await assets.fetch(new Request(target.toString(), c.req.raw))
    }
  }
  const shouldRewrite = shouldRewriteAdminDocument({
    hostname: new URL(c.req.url).hostname,
    method: c.req.method,
    accept: c.req.header('accept'),
    contentType: response.headers.get('content-type'),
    ok: response.ok,
  })
  // The storefront, a HEAD probe, a 304, an error page: returned exactly as
  // the asset layer produced it, with no body handling at all.
  if (!shouldRewrite) return response

  // Everything from here on is best-effort identity polish. The document
  // itself must never depend on it: before this handler existed the asset
  // layer answered these routes on its own, and a throw here would turn the
  // storefront's front page into Hono's JSON 500. So any failure in the
  // rewrite set-up hands back the asset response exactly as produced.
  try {
    return rewriteAdminDocument(response)
  } catch {
    return response
  }
}

function rewriteAdminDocument(response: Response): Response {
  const headers = new Headers(response.headers)
  // The rewritten body has a different length, and the asset layer already
  // set one for the original.
  headers.delete('content-length')
  // Mirrors frontend/public/_headers for '/' and '/index.html'. Set here
  // explicitly because this response is produced by the Worker rather than by
  // the asset layer that applies that file; the pure test fails if the two
  // ever disagree. It matters at deploy time: a client still running the old
  // build revalidates its navigation instead of replaying a cached shell, and
  // so picks up this rewritten document.
  headers.set('Cache-Control', APP_DOCUMENT_CACHE_CONTROL)

  // STREAMED, never buffered: on the free plan this handler has 10 ms of CPU,
  // and HTMLRewriter parses the document as it passes through instead of
  // materialising it. It also cannot touch the inline bootstrap script, which
  // names the same URLs inside quoted selectors -- those are text, not tags.
  let rewriter = new HTMLRewriter()
  for (const rule of ADMIN_DOCUMENT_REWRITES) rewriter = rewriter.on(rule.selector, { element: rule.element })
  return rewriter.transform(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }))
}

// GET and HEAD: run_worker_first hands this Worker every method on these
// paths, and a HEAD that fell through to Hono's 404 would report the app's
// own pages as missing.
for (const route of APP_DOCUMENT_ROUTES) app.on(['GET', 'HEAD'], route, serveAppDocument)

// Sep 17 outage. [assets] sets not_found_handling = "single-page-application",
// which is right for app ROUTES and catastrophic for hashed build chunks: a
// deploy replaces /assets/*, and any client still holding an older shell --
// a service worker serves its cached index.html, and iOS keeps a PWA shell
// for days -- asks for a chunk that no longer exists and gets index.html back
// with status 200. The browser refuses to parse HTML as a module, the page
// stays blank, and every recovery path the app has (the worker's
// recoverStaleShell, utils/chunkReloadGuard.ts) is written against a 404 that
// never arrives. So this prefix is served by the Worker and a miss is an
// honest 404. Costs one Worker invocation per uncached chunk; the asset
// layer's own immutable Cache-Control is passed through untouched, so a
// warm client still pays nothing.
app.on(['GET', 'HEAD'], '/assets/*', async (c) => {
  const assets = c.env.STATIC_ASSETS
  if (!assets) return c.text('Static assets are not bound to this Worker deployment.', 503)
  const response = await assets.fetch(c.req.raw)
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  // The fallback document is the ONLY thing that arrives here as HTML: no
  // real build asset is text/html. Anything else -- a 304, a range response,
  // an error from the asset layer -- is passed through exactly as produced.
  if (response.ok && contentType.includes('text/html')) {
    return c.text('Not found', 404, { 'Cache-Control': 'no-store' })
  }
  return response
})

// P3-L3 (E): robots.txt and sitemap.xml, split by host (lib/publicSeo.ts).
// The storefront is indexable and points at a minimal sitemap; the admin
// host answers "Disallow: /" and has no sitemap. Registered here, above the
// D1 middleware, for the same reason as the document handler: a crawler's
// probe must never cost a database round trip. Both paths are in
// run_worker_first (wrangler.toml and wrangler.free.toml) or the asset
// layer would answer them with the SPA document instead.
const PUBLIC_SEO_CACHE_CONTROL = 'public, max-age=3600'
app.on(['GET', 'HEAD'], '/robots.txt', (c) => {
  const url = new URL(c.req.url)
  return c.text(robotsTxt(url.hostname, url.origin), 200, { 'Cache-Control': PUBLIC_SEO_CACHE_CONTROL })
})
app.on(['GET', 'HEAD'], '/sitemap.xml', (c) => {
  const url = new URL(c.req.url)
  const body = sitemapXml(url.hostname, url.origin)
  if (body === null) return c.notFound()
  return c.body(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': PUBLIC_SEO_CACHE_CONTROL })
})

// Security headers must wrap every early response. Public small envelopes are
// admitted before even bootstrap/maintenance DB work. Other body classes are
// deliberately untouched; AI and screenshots are admitted inside portal gates.
app.use('*', async (c, next) => {
  if (smallBodyAccess(c.req.method, c.req.path) === 'public') {
    const rejection = await admitRequestBody(c, SMALL_BODY_BYTES)
    if (rejection) return rejection
  }
  return next()
})

// Fresh D1 databases need a default org/branch/roles/admin. Memoized per isolate;
// run after public body admission so rejected bodies cannot trigger seeding.
app.use('*', async (c, next) => {
  await ensureCoreDataInvariantsOnce(c.env)
  return next()
})

// Refuse writes during DELETE/reinsert restore. Auth/restore and reads retain
// their existing exemptions; a missing system_flags table still fails open.
app.use('/api/*', async (c, next) => {
  if (isMaintenanceGatedRequest(c.req.method, c.req.path)) {
    const maintenance = await getMaintenance(c.env)
    if (maintenance) {
      return c.json({
        error: 'A backup restore is in progress. The system is read-only until it finishes.',
        maintenance: { mode: maintenance.mode, phase: maintenance.phase, startedAt: maintenance.startedAt },
      }, 503)
    }
  }
  return next()
})

// Preserve the existing unauthenticated/backup-permission responses without
// consuming their bodies. These are control envelopes, never backup contents.
// Body-dependent permission checks still run in the original handlers.
app.use('/api/*', async (c, next) => {
  if (smallBodyAccess(c.req.method, c.req.path) !== 'staff') return next()
  const user = await getSessionUser(c)
  if (!user) return next()
  if (c.req.path === '/api/auth/devices/sessions/revoke-user' && !isAdminControlUser(user)) return next()
  if (c.req.path.startsWith('/api/backups')) {
    if (!hasPermission(user, 'backup')) return next()
    if (c.req.path === '/api/backups/maintenance/clear' && !hasPermission(user, 'backup_restore')) return next()
  }
  const finalize = c.req.path === '/api/system/finalize-migration'
  if (finalize && !hasPermission(user, 'backup_restore')) return next()
  const rejection = await admitRequestBody(c, finalize ? MIGRATION_FINALIZE_BODY_BYTES : SMALL_BODY_BYTES)
  if (rejection) return rejection
  return next()
})

// T10 fallback drain (lib/telegram.ts, "HOW IT IS SCHEDULED"): a shift
// overview whose queue send was unavailable is sent by the next API request
// after it falls due. After the response, off its path, and at most once per
// 20 s per isolate, so it costs one indexed read at that rate and nothing on
// the request itself. The 6-hourly cron is the backstop for a quiet shop.
const SHIFT_OVERVIEW_DRAIN_INTERVAL_MS = 20_000
let lastShiftOverviewDrainMs = 0
app.use('/api/*', async (c, next) => {
  await next()
  const now = Date.now()
  if (now - lastShiftOverviewDrainMs < SHIFT_OVERVIEW_DRAIN_INTERVAL_MS) return
  lastShiftOverviewDrainMs = now
  // Everything inside the async body, so no failure of the drain -- not even
  // a synchronous one -- can reach the response that has already been built.
  const drain = (async () => {
    try { await drainDueTelegramShiftOverviews(c.env, now) } catch (error) { console.error('[telegram] overview drain failed', error) }
  })()
  try { c.executionCtx.waitUntil(drain) } catch { void drain }
})

app.get('/health', (c) => c.json({ status: 'ok', version: 'cloudflare-portal-bootstrap-20260728', time: new Date().toISOString() }))

// Proxies straight into the BroadcastHub Durable Object -- one shared fan-out
// point for every connected client, regardless of which isolate/edge
// location accepted the original upgrade. Previously this route handled
// the WebSocket entirely inside the isolate (accept/ping-pong only, no
// server-initiated push); routes that write data now call broadcast() from
// durable-objects/broadcastHub.ts to push a live update to every open tab.
app.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
  }
  // Session-gate the live event bus. Without this, ANY anonymous client could
  // upgrade and then receive every `sync:update` broadcast frame -- a
  // mutation-metadata side-channel (entity ids, changed-setting key names,
  // brand renames, deleted-row ids across every channel). The browser client
  // only ever opens this with a staff session and already treats close code
  // 4001 as "invalid_session, stop reconnecting" (frontend/src/api/websocket.ts);
  // that gate was intended but never ported to the Worker. Refuse an
  // unauthenticated upgrade by completing the handshake and immediately closing
  // 4001, so the client surfaces "sign in again" instead of reconnect-storming
  // on a generic 1006 failure. The public storefront never opens /ws.
  const user = await getSessionUser(c)
  if (!user) {
    const pair = new WebSocketPair()
    const server = pair[1]
    server.accept()
    server.close(4001, 'invalid_session')
    return new Response(null, { status: 101, webSocket: pair[0] })
  }
  const id = c.env.BROADCAST_HUB.idFromName('global')
  const stub = c.env.BROADCAST_HUB.get(id)
  return stub.fetch(c.req.raw)
})

// Public: serves uploaded files straight from R2. Unauthenticated by design
// -- this mirrors backend/server.ts's GET /uploads/* route, which is also
// public (uploaded product/promotion images need to load on the public
// portal without a login). Access control happens at upload/delete time
// (files.ts requires auth), not at read time.
app.get('/uploads/*', async (c) => {
  const key = `uploads/${c.req.path.replace(/^\/uploads\//, '')}`
  return serveObject(c.env.ASSETS, key, c.req.raw, c.executionCtx)
})

app.route('/api/settings', settingsRoute)
app.route('/api/products', productsRoute)
app.route('/api/products', productCostRoute)
app.route('/api/portal', portalRoute)
app.route('/api/sales', salesRoute)
app.route('/api/auth', authRoute)
app.route('/api/auth/devices', devicesRoute)
app.route('/api/files', filesRoute)
app.route('/api/branches', branchesRoute)
app.route('/api/promotions', promotionsRoute)
app.route('/api/backups', backupsRoute)
app.route('/api', lookupsRoute)
app.route('/api', contactsRoute)
app.route('/api/inventory', inventoryRoute)
app.route('/api/inventory/fast-stock-in', stockInCommitRoute)
app.route('/api/ai', aiRoute)
app.route('/api/import-jobs', importJobsRoute)
app.route('/api/returns', returnsRoute)
app.route('/api/system', systemRoute)
app.route('/api/notifications', notificationsRoute)
app.route('/api/organizations', organizationsRoute)
app.route('/api/action-history', actionHistoryRoute)
app.route('/api/runtime', runtimeRoute)
app.route('/api/notes', notesRoute)
app.route('/api/batches', batchesRoute)
app.route('/api/shifts', shiftsRoute)
app.route('/api/fees', feesRoute)
app.route('/api/reports', reportsRoute)
app.route('/api/telegram', telegramRoute)
app.route('/api/review', reviewQueueRoute)
app.route('/api/pos', posRoute)
app.route('/api', usersRoute)
app.route('/api', compatRoute)
app.route('/api/sync', createSyncRoute(app))

export { SyncUploadSession } from './durable-objects/syncUploadSession'
export { BroadcastHub } from './durable-objects/broadcastHub'

export default {
  fetch: app.fetch,
  // Cloudflare routes a queue message batch here based on which queue it
  // came from (wrangler.toml's [[queues.consumers]] entries), not by name
  // collision -- both consumers are declared, so we dispatch on the queue's
  // own name off the batch itself.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    if (batch.queue === 'business-os-import') {
      await handleImportQueue(batch as MessageBatch<{ jobId: string; kind: 'analyze' | 'apply' | 'bulk-delete' }>, env)
    } else if (batch.queue === 'business-os-import-dlq') {
      await handleImportDeadLetterQueue(batch as MessageBatch<{ jobId: string; kind: 'analyze' | 'apply' | 'bulk-delete' }>, env)
    } else if (batch.queue === 'business-os-media') {
      await handleMediaQueue(batch as MessageBatch<{ assetKey: string; kind: 'optimize-video' | 'optimize-image' }>, env)
    } else if (batch.queue === 'business-os-backup-assets') {
      // T10's delayed shift overview rides the backup queue (bound on both
      // plans, so no new queue has to exist before a deploy). Its messages
      // are taken out here; everything else goes to handleBackupQueue as
      // before, which reads nothing off the batch but `messages`. A message
      // is acknowledged whatever the outcome: the send row in D1 is the
      // record, and a retry is the drain's job, never a second delivery.
      const overviews = batch.messages.filter((message) => isShiftOverviewQueueMessage(message.body))
      for (const message of overviews) {
        try {
          const outcome = await deliverTelegramShiftOverview(env, (message.body as { key: string }).key)
          if (outcome === 'not-due') message.retry({ delaySeconds: 30 })
          else message.ack()
        } catch (error) {
          console.error('[telegram] overview queue delivery failed; the drain will pick it up', error)
          message.ack()
        }
      }
      if (overviews.length === batch.messages.length) return
      // No overview in the batch: the batch goes through untouched.
      const backupBatch = overviews.length
        ? { queue: batch.queue, messages: batch.messages.filter((message) => !isShiftOverviewQueueMessage(message.body)) } as unknown as MessageBatch<unknown>
        : batch
      await handleBackupQueue(backupBatch as MessageBatch<
        | { kind: 'backup-continue'; backupName: string; nextIndex: number }
        | { kind: 'drive-sync'; jobId: string }
        | { kind: 'drive-restore-stage'; jobId: string }
      >, env)
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      // Restore maintenance: skip the whole tick. A scheduled backup taken
      // DURING a restore would snapshot the half-restored database as if it
      // were a good state; the sweeps behind it write too. The next 6h tick
      // runs normally once maintenance clears.
      if (await getMaintenance(env)) return

      // Each sweep runs in its OWN guard. These used to be a bare await-chain,
      // so the FIRST step to throw aborted every step behind it -- and the
      // heaviest, maybeRunScheduledBackup, is exactly the one that starts
      // throwing once the database grows large (a full backup on a multi-
      // hundred-MB D1 can hit the CPU / wall-time ceiling, and its create
      // path is not internally caught). That silently starved import- and
      // audit-log retention on every tick, so the import staging those sweeps
      // prune piled up unbounded -- which made the database larger and the
      // backup even more likely to fail: a self-reinforcing spiral that took
      // the production DB to ~661 MB, ~65% stale import staging (see
      // importRetention.ts). Isolating each step means a failing backup can
      // no longer stop retention from reclaiming the space that lets the next
      // backup succeed. Order is unchanged (backup first, image-audit last);
      // independence changes only what a failure does to the steps after it.
      const runStep = async (label: string, step: () => Promise<unknown>) => {
        try {
          await step()
        } catch (error) {
          console.error(`[scheduled] ${label} failed`, (error as Error)?.message || error)
        }
      }
      // T10: the backstop for a shift overview nothing else has sent. Ahead
      // of the backup because it is a few indexed statements and the backup
      // is the step that runs out of budget.
      await runStep('telegram-shift-overview', () => drainDueTelegramShiftOverviews(env, Date.now(), { limit: 10, sweepStale: true }))
      await runStep('backup', () => maybeRunScheduledBackup(env))
      await runStep('drive-sync', async () => {
        const schedule = await driveSyncScheduleDue(env)
        if (!schedule.due) return schedule
        return enqueueDriveSyncJob(env, 'scheduled')
      })
      await runStep('audit-log-retention', () => maybeRunScheduledAuditLogRetention(env))
      // Reap stalled import jobs into a terminal status BEFORE retention runs,
      // so a job stuck in analyzing/applying (e.g. a killed queue invocation)
      // is pruned this same tick. Previously this ran ONLY on the Import Jobs
      // screen's GET, so a stalled job held its full staging until someone
      // happened to open that page.
      await runStep('reap-stalled-imports', () => reapStalledImportJobs(env))
      // K4: import-artifact retention (24h detail / 7d summary).
      await runStep('import-retention', () => maybeRunScheduledImportRetention(env))
      // Drain orphan staging automatically (rows whose parent import_jobs row
      // is already gone) -- previously reachable only via a manual, force-only
      // admin endpoint, so orphans accumulated with no automatic drain.
      await runStep('orphan-staging-cleanup', () => cleanOrphanImportStaging(env, { apply: true }))
      // Prune ephemeral / log / expired-auth tables (rate_limit_events,
      // sessions, verification_codes, lockouts, ai_response_logs, action_history)
      // that had no automatic retention at all before the Aug-31 audit.
      await runStep('ephemeral-retention', () => maybeRunScheduledEphemeralRetention(env))
      // Last on purpose: it is the only one of these optional to the business.
      await runStep('image-audit', () => maybeRunScheduledImageAudit(env))
    })())
  },
}
