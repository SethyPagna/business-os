'use strict'
// A small real-route harness for the Inventory read routes (INV-A S4a): the real Hono route modules over the real migrations in an in-memory database, the Cache API
// and KV stubbed in memory, auth replaced by "the current user". It records every statement the Worker prepares, so a test can pin statement text and counts.
//
//   const app = createInvApp({ mount: { '/api/products': 'routes/products.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' } })
//   app.setUser(app.users.admin); await app.get('/api/products/search?page=1')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { seedStockFixture } = require('./seed-stock-fixture.cjs')

const SRC = path.join(__dirname, '..', '..', 'src')

function person(id, role, permissions, organizationId = null) {
  return { id, username: `u${id}`, name: `U${id}`, role_code: role, organization_id: organizationId, permissions: JSON.stringify(permissions), role_permissions: JSON.stringify(permissions) }
}
const IC_ALL_FIELDS = Object.fromEntries(['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost'].map((f) => [`inventory_check_show_${f}`, true]))
const USERS = {
  admin: person(71, 'admin', { all: true }),
  // Inventory Check with every field granted, plus Products and Inventory (reads Products as itself).
  checker: person(72, 'employee', { products: true, inventory: true, inventory_checks: true, inventory_checks_check: true, ...IC_ALL_FIELDS }),
  // A blind counter: counting only, no stock, no barcode, no price; sees brand; no Products or Inventory page.
  blind: person(73, 'employee', { inventory_checks: true, inventory_checks_check: true, inventory_check_show_brand: true, inventory_check_show_category: true }),
  // Inventory Check with stock but no Products page, no price, no barcode.
  stockOnly: person(74, 'employee', { inventory_checks: true, inventory_checks_check: true, inventory_check_show_stock: true, inventory_check_show_received: true }),
  // No Inventory Check at all.
  none: person(75, 'employee', { products: true }),
}

function createInvApp({ mount, seed, users = USERS }) {
  const moduleCache = new Map()
  let current = users.admin
  const statements = []
  const stubs = {
    'lib/audit.ts': { audit: async () => {} },
    'durable-objects/broadcastHub.ts': { broadcast: async () => {} },
  }
  function load(rel) {
    if (moduleCache.has(rel)) return moduleCache.get(rel).exports
    const mod = { exports: {} }
    moduleCache.set(rel, mod)
    const sourcePath = path.join(SRC, rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath,
    }).outputText
    new Function('require', 'module', 'exports', output)((request) => {
      if (!request.startsWith('.')) return request.startsWith('cloudflare:') ? { DurableObject: class {} } : require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
      if (stubs[file]) return stubs[file]
      if (file === 'lib/db.ts') return { ...load(file), getDb: (env) => env.DB }
      if (file === 'lib/auth.ts') return { ...load(file), requireAuth: async (c, next) => { c.set('user', current); return next() }, getSessionUser: async () => current }
      return load(file)
    }, mod, mod.exports)
    return mod.exports
  }

  const cacheStore = new Map()
  globalThis.caches = {
    default: {
      match: async (request) => (cacheStore.has(request.url) ? new Response(cacheStore.get(request.url)) : undefined),
      put: async (request, response) => { cacheStore.set(request.url, await response.text()) },
    },
  }
  const kv = new Map()
  const CACHE = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)) }, delete: async (k) => { kv.delete(k) } }

  const raw = openDb(loadAll())
  seedStockFixture(raw.db, () => {
    raw.prepare("INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
    raw.prepare("INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(2,'Store',0,1)").run()
  })
  if (seed) seed(raw, seedStockFixture)

  const counters = { pageQueries: 0 }
  const db = {
    prepare(sql) { statements.push(String(sql)); if (/\bmatched AS\b/.test(sql)) counters.pageQueries++; return raw.prepare(sql) },
    batch: async (list) => { for (const s of list) statements.push(String(s.sql)); if (list.some((s) => /\bmatched AS\b/.test(s.sql))) counters.pageQueries++; return raw.batch(list) },
    exec: (sql) => raw.exec(sql),
  }
  db.staging = db
  const env = { DB: db, CACHE, ENVIRONMENT: 'test' }
  const app = new Hono()
  for (const [prefix, rel] of Object.entries(mount)) app.route(prefix, typeof rel === 'string' ? load(rel).default : rel(load))

  async function request(method, url, body, withEnv = env) {
    load('lib/planTier.ts').__resetPlanTierCacheForTests()
    const waits = []
    const init = { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }
    const response = await app.request(`http://localhost${url}`, init, withEnv, { waitUntil: (p) => waits.push(p), passThroughOnException() {} })
    const text = await response.text()
    await Promise.all(waits)
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: response.status, json, text }
  }

  function setSwitch(name, value) {
    const doc = raw.prepare("SELECT value FROM system_flags WHERE key='read_switches'").get()
    const parsed = doc ? JSON.parse(doc.value) : { epoch: 1, set_at: '2026-11-04T00:00:00.000Z', set_by: 1, switches: {} }
    if (value === undefined) delete parsed.switches[name]; else parsed.switches[name] = value
    raw.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify(parsed))
    load('lib/readSwitches.ts').resetReadSwitchMemo?.()
  }

  return {
    raw, env, load, users, statements, counters, cacheStore, kv, seedStockFixture,
    setUser: (user) => { current = user },
    get: (url, withEnv) => request('GET', url, undefined, withEnv),
    send: (method, url, body, withEnv) => request(method, url, body, withEnv),
    setSwitch,
    mark: () => statements.length,
    since: (mark) => statements.slice(mark),
    clearCaches: () => { cacheStore.clear() },
  }
}

module.exports = { createInvApp, USERS, person, IC_ALL_FIELDS }
