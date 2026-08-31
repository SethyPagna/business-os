import { Hono } from 'hono'
import settingsRoute from './routes/settings'
import productsRoute from './routes/products'
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
import feesRoute from './routes/fees'
import reviewQueueRoute from './routes/reviewQueue'
import { createSyncRoute } from './routes/sync'
import { ensureCoreDataInvariantsOnce } from './lib/coreDataInvariants'
import { reportError } from './lib/errorReporting'
import { serveObject } from './lib/r2'
import { handleImportQueue, handleImportDeadLetterQueue, handleMediaQueue, handleBackupQueue } from './queue'
import { maybeRunScheduledBackup } from './lib/backup'
import { maybeRunScheduledDriveSync } from './lib/googleDrive'
import { maybeRunScheduledAuditLogRetention } from './lib/audit'
import { maybeRunScheduledImportRetention } from './lib/importRetention'
import { maybeRunScheduledImageAudit } from './lib/imageAudit'

export type Env = {
  DB: D1Database
  ASSETS: R2Bucket
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
  IMPORT_QUEUE: Queue
  MEDIA_QUEUE: Queue
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

// Fresh D1 database (migrations applied, never factory-reset) starts with
// zero branches/roles/admin user -- nothing to log in with and nowhere for
// a product to be assigned. This makes sure a default org/branch/roles/
// admin always exist before any request is handled, so "empty app" behaves
// the same as "just factory-reset" instead of being a dead end. Memoized
// per-isolate inside ensureCoreDataInvariantsOnce(), so this is a no-op
// DB-wise after the isolate's first request.
app.use('*', async (c, next) => {
  await ensureCoreDataInvariantsOnce(c.env)
  return next()
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

app.get('/health', (c) => c.json({ status: 'ok', version: 'cloudflare-portal-bootstrap-20260728', time: new Date().toISOString() }))

// Proxies straight into the BroadcastHub Durable Object -- one shared fan-out
// point for every connected client, regardless of which isolate/edge
// location accepted the original upgrade. Previously this route handled
// the WebSocket entirely inside the isolate (accept/ping-pong only, no
// server-initiated push); routes that write data now call broadcast() from
// durable-objects/broadcastHub.ts to push a live update to every open tab.
app.get('/ws', (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426)
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
  return serveObject(c.env.ASSETS, key, c.req.raw)
})

app.route('/api/settings', settingsRoute)
app.route('/api/products', productsRoute)
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
app.route('/api/fees', feesRoute)
app.route('/api/review', reviewQueueRoute)
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
      await handleBackupQueue(batch as MessageBatch<{ kind: 'backup-continue'; backupName: string; nextIndex: number }>, env)
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      maybeRunScheduledBackup(env)
        .then(() => maybeRunScheduledDriveSync(env))
        .then(() => maybeRunScheduledAuditLogRetention(env))
        // K4: import-artifact retention (24h detail / 7d summary). Swallows
        // its own errors, so it cannot break the image audit behind it.
        .then(() => maybeRunScheduledImportRetention(env))
        // Last on purpose: it is the only one of these that is optional to
        // the business. A backup must never be skipped because an image
        // sweep ran long, and maybeRunScheduledImageAudit swallows its own
        // errors so it cannot break the chain either.
        .then(() => maybeRunScheduledImageAudit(env))
        .then(() => undefined),
    )
  },
}
