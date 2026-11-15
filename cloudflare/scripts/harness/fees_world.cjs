'use strict'
// The REAL routes/fees.ts and routes/feesCatalog.ts (mounted in index.ts's order) over an in-memory SQLite that carries the
// full production migration chain, with the real permissions, the real sales kernel (lib/salesAnalytics.ts) and the real
// shift reconciliation. Only the session, the push hub, Telegram, the review queue and the cache-version bump are stubbed.
//   const w = createFeesWorld()
//   w.sql.exec('INSERT ...')                      // seed through the raw handle
//   const r = await w.request('GET', '/api/fees/types', undefined, w.users.full)
//   w.load('lib/salesAnalytics.ts')               // any real module, loaded through the same overrides
// `patches` rewrite a source file in memory (mutation controls); nothing on disk changes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const SRC = path.join(__dirname, '..', '..', 'src')

function createFeesWorld({ patches = [], overrides = {}, through } = {}) {
  const raw = openDb(loadAll({ through }))
  const state = { user: null }
  const broadcasts = []
  const telegrams = []
  const ctxOverrides = {
    '../lib/db': { getDb: () => raw },
    './db': { getDb: () => raw },
    '../lib/auth': {
      requireAuth: async (c, next) => {
        if (c.get('user')) return next()
        if (!state.user) return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
        c.set('user', state.user)
        return next()
      },
    },
    '../durable-objects/broadcastHub': { broadcast: async (...args) => { broadcasts.push(args) } },
    '../lib/telegram': { sendTelegramEvent: async (...args) => { telegrams.push(args) }, telegramMoney: () => '' },
    '../lib/reviewGate': { maybeQueueForReview: async () => null },
    '../index': {},
    // Fee writes await bumpVersions(env, ['sales']) (A-C2); the real one needs KV and D1 bindings this world does not have.
    '../lib/cache': { bumpVersions: async () => {} },
    ...overrides,
  }

  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(SRC, rel)
    let text = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
    for (const patch of patches.filter((p) => p.file === `src/${rel}`)) {
      assert.equal(text.split(patch.from).length - 1, 1, `mutant anchor must occur once: ${patch.from.slice(0, 70)}`)
      text = text.replace(patch.from, () => patch.to)
    }
    const output = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(ctxOverrides, request)) return ctxOverrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }

  const { Hono } = require('hono')
  const root = new Hono()
  root.route('/api/fees', load('routes/feesCatalog.ts').default)
  root.route('/api/fees', load('routes/fees.ts').default)
  root.route('/api/reports', load('routes/reports.ts').default)

  const executionCtx = { waitUntil(promise) { return promise }, passThroughOnException() {} }
  // `env` is the Worker's bindings for this request (e.g. { PLAN_TIER: 'free' }); lib/planTier.ts caches the tier per module, so a test that changes it
  // resets the cache first (w.load('lib/planTier.ts').__resetPlanTierCacheForTests()).
  async function request(method, url, body, user, headers = {}, env = {}) {
    state.user = user
    const init = { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }
    if (body !== undefined) init.body = JSON.stringify(body)
    const response = await root.request(url, init, env, executionCtx)
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return { status: response.status, json }
  }

  // The chain's old-system migration seeds thousands of real-shaped expenses; every scenario starts from an empty ledger.
  raw.db.exec('DELETE FROM fees; DELETE FROM fee_operation_receipts; DELETE FROM audit_logs;')

  const person = (id, permissions, extra = {}) => ({
    id, username: `user${id}`, name: `User ${id}`, role_code: extra.role_code ?? 'staff', is_active: 1,
    permissions: JSON.stringify(permissions), role_permissions: null, ...extra,
  })
  const users = {
    admin: person(1, {}, { role_code: 'admin' }),
    full: person(2, { fees: true, sales: true }),
    noSales: person(3, { fees: true }),
    courierOff: person(4, { fees: true, sales: true, 'sales:view_courier_cost': false }),
    noEdit: person(5, { fees: true, sales: true, 'fees:edit': false }),
    review: person(6, { fees: 'review', sales: true }),
    nothing: person(7, {}),
    noView: person(8, { fees: true, 'fees:view': false }),
  }
  for (const u of Object.values(users)) {
    raw.db.prepare('INSERT OR IGNORE INTO users (id, username, name, password, permissions, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(u.id, u.username, u.name, 'x', u.permissions)
  }

  const sql = raw.db
  const all = (query, ...params) => sql.prepare(query).all(...params)
  const get = (query, ...params) => sql.prepare(query).get(...params)
  return { raw, sql, request, users, load, all, get, broadcasts, telegrams, env: {} }
}

module.exports = { createFeesWorld }
