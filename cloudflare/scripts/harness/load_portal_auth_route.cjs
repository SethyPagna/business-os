// Loads the REAL routes/portal.ts with its real auth chain (lib/portalAccounts,
// lib/portalAuthLockout, lib/portalAbuseKey, lib/rateLimit, lib/portalSession,
// lib/phone ...) against an in-memory SQLite database carrying every
// migration. Only platform pieces are stubbed: the staff session, the audit
// sink, the live-update hub, R2 and the AI provider call (portalAi's
// generatePortalAiResponse is replaced by a counter, so no request leaves the
// machine).
//
// Usage:
//   const h = createPortalHarness()
//   await h.request('/auth/signup', 'POST', { ... }, { ip: '203.0.113.9' })
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { fakeKv } = require('./load_auth_route.cjs')

function dbAdapter(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (params) => stmt.get(params),
        all: async (params) => stmt.all(params) || [],
        run: async (params) => {
          const info = stmt.run(params)
          return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => raw.batch(items),
    exec: (sql) => raw.exec(sql),
  }
}

function createPortalHarness(options = {}) {
  const raw = openDb(loadAll())
  const db = dbAdapter(raw)
  const aiCalls = []
  const env = {
    DB: raw,
    CACHE: fakeKv(),
    PORTAL_ABUSE_HMAC_SECRET: 'p'.repeat(48),
    BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com',
    BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
    ...(options.env || {}),
  }
  const overrides = {
    '../lib/db': { getDb: () => db },
    './db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c) => c.json({ error: 'Not authenticated' }, 401) },
    '../lib/audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/r2': { serveObject: async () => new Response(null, { status: 404 }) },
    '../lib/portalAi': {
      generatePortalAiResponse: async (_env, args) => {
        aiCalls.push(args)
        return { summary: 'ok', recommendations: [], requestPolicy: {} }
      },
    },
    ...(options.overrides || {}),
  }
  const sources = options.sources || {}

  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', '..', 'src', rel)
    const source = Object.prototype.hasOwnProperty.call(sources, rel) ? sources[rel] : fs.readFileSync(sourcePath, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }

  const portal = load('routes/portal.ts')
  const app = portal.default

  async function request(pathname, method = 'POST', body, { ip = '203.0.113.9', headers = {} } = {}) {
    const allHeaders = { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...headers }
    if (body !== undefined) allHeaders['Content-Type'] = 'application/json'
    const response = await app.request(pathname, {
      method, headers: allHeaders, body: body === undefined ? undefined : JSON.stringify(body),
    }, env, { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) {}
    return { status: response.status, body: json, headers: response.headers }
  }

  return { env, raw, db, app, portal, request, aiCalls, load }
}

module.exports = { createPortalHarness }
