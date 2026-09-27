// Loads the REAL routes/products.ts and every module it imports, resolved by
// relative path from src/, against an in-memory SQLite database with every
// migration applied. The real lib/audit.ts writes real audit_logs rows.
// Only Worker-runtime seams are stubbed: the session (auth), the KV cache,
// the broadcast Durable Object, rate limiting, upload sniffing, the image
// normalisation queue and the review queue.
//
// Usage:
//   const h = createProductsRouteHarness()
//   h.setActionTier(() => 'full')
//   const res = await h.request('GET', '/rename-impact?kind=unit&from=a&to=b')
//   h.raw.prepare('SELECT * FROM audit_logs').all()
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const SRC_DIR = path.join(__dirname, '..', '..', 'src')

// lib/db.ts's D1Compat answers run() with { changes, lastInsertRowid } and
// all() with a plain row array; the shared harness answers D1's raw shape.
function dbAdapter(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      let bound
      const api = {
        bind: (...args) => { bound = args.length === 1 ? args[0] : args; return api },
        get: async (params) => stmt.get(params !== undefined ? params : bound) ?? null,
        all: async (params) => stmt.all(params !== undefined ? params : bound) ?? [],
        run: async (params) => {
          const info = stmt.run(params !== undefined ? params : bound)
          return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) }
        },
      }
      return api
    },
    batch: (items) => raw.batch(items),
    batchOnce: (items) => raw.batch(items),
    exec: (sql) => raw.exec(sql),
    staging: null,
  }
}

function createProductsRouteHarness(options = {}) {
  const raw = openDb(loadAll())
  const db = dbAdapter(raw)
  db.staging = db
  let user = options.user || { id: 1, username: 'tester', name: 'Test User', permissions: '{}' }
  let actionTier = () => 'full'

  const overrides = {
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', user); return next() } },
    '../lib/cache': {
      cachedJsonResponse: async (_request, _c, _version, _ttl, producer) => producer(),
      getVersion: async () => '0',
      getVersionWithFallback: async () => 1,
      bumpVersion: async () => {},
      bumpVersions: async () => {},
    },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, ok: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
    '../lib/uploadSecurity': { validateUploadedBuffer: async () => ({ ok: true }) },
    '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
    '../lib/reviewGate': { maybeQueueForReview: async () => null },
    ...(options.overrides || {}),
  }

  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(SRC_DIR, rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      if (resolved === 'lib/permissions' || resolved === 'lib/permissions.ts') return permissions()
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }

  // The real permission kernel, with getActionTier routed through the
  // test's own switch so a denial path is reachable without a roles fixture.
  let permissionsModule = null
  function permissions() {
    if (!permissionsModule) {
      const real = load('lib/permissions.ts')
      permissionsModule = { ...real, getActionTier: (...args) => actionTier(...args) }
    }
    return permissionsModule
  }

  const app = load('routes/products.ts').default
  const executionCtx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }

  async function request(method, pathname, body) {
    const init = { method, headers: { 'content-type': 'application/json' } }
    if (body !== undefined) init.body = JSON.stringify(body)
    const res = await app.request(`http://local${pathname}`, init, { DB: raw }, executionCtx)
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  return {
    raw,
    db,
    app,
    request,
    setActionTier(fn) { actionTier = fn },
    setUser(next) { user = next },
  }
}

module.exports = { createProductsRouteHarness }
