// Real Worker routes on real SQLite, for the website posts tests
// (test-portal-posts-*.cjs).
//
// Transpiles the REAL route files and every relative module they import, and
// runs them against in-memory SQLite carrying every real migration. Only the
// platform edges are replaced, keyed by ABSOLUTE path so one entry covers a
// module however its importers spell it ('../lib/db' from routes/, './db'
// from lib/):
//   - D1: the SQLite wrapper below, which also counts statements so a test
//     can hold a route to the free plan's per-invocation query budget;
//   - KV (env.CACHE) and the Workers Cache API (caches.default): in-memory
//     maps the test can inspect;
//   - the Durable Object broadcast hub: records what was broadcast;
//   - the AI provider and the image-normalization queue: no-ops;
//   - the session check: the test chooses the signed-in user.
// Pattern: test-portal-submissions-guard-pure.cjs.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')
const { Hono } = require('hono')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')

const SRC = path.join(__dirname, '..', '..', 'src')

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return base
}

function createWorker() {
  const rawDb = openDb(loadAll())
  const stats = { queries: 0 }
  const flatRun = (result) => ({ changes: result.meta?.changes ?? 0, lastInsertRowid: Number(result.meta?.last_row_id ?? 0) })
  const db = {
    prepare(sql) {
      return {
        get: async (params) => { stats.queries += 1; return rawDb.prepare(sql).get(params) },
        all: async (params) => { stats.queries += 1; return rawDb.prepare(sql).all(params) || [] },
        run: async (params) => { stats.queries += 1; return flatRun(rawDb.prepare(sql).run(params)) },
      }
    },
    batch: async (items) => { stats.queries += items.length; return rawDb.batch(items) },
  }

  const kv = new Map()
  const cacheEntries = new Map()
  const cacheApi = {
    match: async (request) => cacheEntries.get(request.url)?.clone(),
    put: async (request, response) => { cacheEntries.set(request.url, response.clone()) },
    delete: async (request) => cacheEntries.delete(request.url),
  }
  global.caches = { default: cacheApi }

  const env = {
    CACHE: {
      get: async (key, type) => {
        const value = kv.has(key) ? kv.get(key) : null
        return value != null && type === 'json' ? JSON.parse(value) : value
      },
      put: async (key, value) => { kv.set(key, String(value)) },
      delete: async (key) => { kv.delete(key) },
      list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })), list_complete: true }),
    },
    PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-is-at-least-thirty-two-characters',
  }
  const pending = []
  const ctx = {
    waitUntil: (promise) => { if (promise && typeof promise.then === 'function') pending.push(promise.catch(() => {})) },
    passThroughOnException() {},
  }
  const broadcasts = []
  let user = null

  const moduleCache = new Map()
  const overrides = new Map()
  const override = (relPath, exportsObject) => overrides.set(path.normalize(path.join(SRC, relPath)), exportsObject)
  override('lib/db.ts', { getDb: () => db })
  override('durable-objects/broadcastHub.ts', { broadcast: async (_env, channel, payload) => { broadcasts.push({ channel, payload }) } })
  override('lib/portalAi.ts', { generatePortalAiResponse: async () => ({ answer: '' }), getPortalAiUsageStatus: () => ({}) })
  override('lib/imageAudit.ts', { enqueueImageNormalization: async () => {} })
  override('lib/auth.ts', {
    requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthorized' }, 401)
      c.set('user', user)
      await next()
    },
  })

  function loadFile(sourcePath) {
    const key = path.normalize(sourcePath)
    if (overrides.has(key)) return overrides.get(key)
    if (moduleCache.has(key)) return moduleCache.get(key)
    const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: key,
    })
    const moduleObj = { exports: {} }
    moduleCache.set(key, moduleObj.exports)
    const packageRequire = Module.createRequire(key)
    const scopedRequire = (request) => (request.startsWith('.')
      ? loadFile(resolveTs(path.resolve(path.dirname(key), request)))
      : packageRequire(request))
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key),
    )
    moduleCache.set(key, moduleObj.exports)
    return moduleObj.exports
  }
  const load = (relPath) => loadFile(resolveTs(path.join(SRC, relPath)))
  // A route module mounted at its production prefix (index.ts), so c.req.path
  // and every cache key are the ones the deployed Worker sees.
  const mount = (prefix, relPath) => new Hono().route(prefix, load(relPath).default)

  // One HTTP call into a route module's Hono app, with every waitUntil task
  // settled before the response is handed back (cache writes, audit rows,
  // broadcasts), and the D1 statements that call issued.
  async function call(app, method, url, body) {
    const before = stats.queries
    const init = { method, headers: {} }
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const response = await app.request(`https://shop.test${url}`, init, env, ctx)
    while (pending.length) await Promise.all(pending.splice(0))
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: response.status, body: json, queries: stats.queries - before }
  }

  return {
    rawDb,
    db,
    env,
    ctx,
    kv,
    cacheEntries,
    broadcasts,
    stats,
    load,
    mount,
    override,
    call,
    setUser(next) { user = next },
  }
}

// Runs `fn` with the clock frozen at `iso`: both `Date.now()` and a no-argument
// `new Date()` answer that instant, so code on either spelling sees it.
const RealDate = Date
function atInstant(iso, fn) {
  const fixed = RealDate.parse(iso)
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])) }
    static now() { return fixed }
  }
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate })
}

module.exports = { createWorker, atInstant }
