'use strict'
// The bell's plan-lifetime sections are stored under the time their producer STARTED, and a producer that started earlier never overwrites an entry
// that a producer which started later already stored (routes/notifications.ts, sectionCacheFor -> cached, the ttlOnly branch).
//
// Loads the REAL routes/notifications.ts and lib/cache.ts against an in-memory SQLite database. The Cache API is a Map, KV is a Map, and the clock is a
// number the test moves. A producer is parked after it has READ the rows (so its value is the old data) and released on cue; that is what makes a write
// ordering visible: the parked value is stale, so storing it over a newer entry shows up as the old count.
//
// Cases 1 to 8 are the interleavings of the spec (SPEC-bell-catchup.md, B1), B5 is a busy shop, C2 is the stored time.
// Mutants this test must kill (each applied by hand, run, recorded, reverted):
//   always write (no match before the put)   -> case 2, case 4
//   never write                              -> case 1, B5
//   `at` is the end of the producer          -> C2
//   `>=` instead of `>`                      -> case 5
//   skip the put when the versions moved     -> B5
//   match before the producer, not the put   -> case 2
//
// Run: node scripts/test-bell-cache-write-order-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const raw = openDb(loadAll())
raw.db.limits.exprDepth = 100

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

// ---- database; a one-shot seam parks the inventory producer after it has read its rows --------------
let afterInventoryRows = null
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    const isInventory = /out_of_stock_threshold/.test(sql) && /FROM products/.test(sql)
    return {
      all: async (params) => {
        const rows = stmt.all(params) ?? []
        if (isInventory && afterInventoryRows) { const hook = afterInventoryRows; afterInventoryRows = null; await hook() }
        return rows
      },
      get: async (params) => stmt.get(params) ?? null,
      run: async (params) => { const info = stmt.run(params); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => raw.batch(items),
  exec: (sql) => raw.exec(sql),
}

let currentUser = null
const overrides = {
  '../lib/db': { getDb: () => db },
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
}
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

// ---- Cache API (a Map) whose write-path match of the inventory entry can be parked; KV (a Map) ---------
const cacheStore = new Map()
let parkNextInventoryMatch = null
let knownKey = null
globalThis.caches = {
  default: {
    async match(request) {
      const hit = cacheStore.get(request.url)
      const result = hit ? hit.clone() : undefined
      if (parkNextInventoryMatch && request.url === knownKey) {
        const park = parkNextInventoryMatch
        parkNextInventoryMatch = null
        park.reached.resolve()
        await park.release.promise
      }
      return result
    },
    async put(request, response) { cacheStore.set(request.url, response) },
  },
}
const kv = new Map()
const env = {
  DB: raw,
  PLAN_TIER: 'paid',
  CACHE: {
    async get(key) { return kv.has(key) ? kv.get(key) : null },
    async put(key, value) { kv.set(key, String(value)) },
    async delete(key) { kv.delete(key) },
  },
}
const app = load('routes/notifications.ts').default
const cacheModule = load('lib/cache.ts')
const ttlSeconds = load('lib/planTier.ts').getPlanLimits(env).notificationSectionCacheSeconds

const realNow = Date.now
const clock = { t: 0 }
const at = (ms) => { clock.t = ms }

// A request with its own waitUntil list, so one parked write never blocks another request.
function request(pathname, user) {
  const waiting = []
  const executionCtx = { waitUntil: (promise) => { waiting.push(Promise.resolve(promise)) }, passThroughOnException() {} }
  return (async () => {
    currentUser = user
    const res = await app.request(`http://local${pathname}`, { method: 'GET' }, env, executionCtx)
    const text = await res.text()
    await Promise.all(waiting)
    return { status: res.status, json: text ? JSON.parse(text) : null }
  })()
}
const ADMIN = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }
const STOCK_ONLY = { id: 3, username: 'stock', name: 'Stock', role_code: 'staff', permissions: JSON.stringify({ inventory: true }) }
const plain = (user = STOCK_ONLY) => request('/summary', user)
const fresh = (user = STOCK_ONLY) => request('/summary?fresh=1', user)
const inventoryCount = (res) => (res.json.sections || []).find((entry) => entry.id === 'inventory').count

// The Cache API keys are hashed, so the inventory entry's key is learned once, from the entry whose value is the inventory section.
const inventoryKey = () => (cacheStore.has(knownKey) ? knownKey : undefined)
async function stored() {
  const key = inventoryKey()
  if (!key) return null
  return cacheStore.get(key).clone().json()
}
async function learnKey() {
  for (const [url, response] of cacheStore) { const entry = await response.clone().json(); if (entry?.value?.id === 'inventory') return url }
  return null
}
function seed() {
  seedStockFixture(raw.db, () => {
    const insert = raw.db.prepare('INSERT INTO products (name, stock_quantity, out_of_stock_threshold, low_stock_threshold, is_active) VALUES (?, ?, ?, ?, ?)')
    for (let i = 0; i < 6; i += 1) insert.run(`Out ${i}`, 0, 2, 10, 1)
    for (let i = 0; i < 4; i += 1) insert.run(`Low ${i}`, 5, 0, 10, 1)
    for (let i = 0; i < 80; i += 1) insert.run(`Healthy ${i}`, 50 + i, 0, 10, 1)
  })
}
let nextHealthy = 0
// A write that resolves one more alert: the stock change and the version bumps its route makes before it responds.
async function write() {
  seedStockFixture(raw.db, () => raw.db.prepare('UPDATE products SET stock_quantity = 0 WHERE name = ?').run(`Healthy ${nextHealthy}`))
  nextHealthy += 1
  await cacheModule.bumpVersion(env, 'stock')
  await cacheModule.bumpVersion(env, 'products')
}
// Parks the next inventory producer after it read its rows; returns the handles.
function parkProducer(whileParked) {
  const reached = deferred()
  const release = deferred()
  afterInventoryRows = async () => { reached.resolve(); if (whileParked) whileParked(); await release.promise }
  return { reached: reached.promise, release: release.resolve }
}
const reset = () => { cacheStore.clear(); afterInventoryRows = null; parkNextInventoryMatch = null }

let passed = 0
async function check(name, fn) {
  reset()
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  seed()
  Date.now = () => clock.t
  at(1_700_000_000_000)
  await plain()
  knownKey = await learnKey()
  reset()
  const T = 1_700_000_000_000
  let base = 0
  const baseCount = () => raw.db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND (COALESCE(stock_quantity,0) <= COALESCE(out_of_stock_threshold,0) OR COALESCE(stock_quantity,0) <= low_stock_threshold)').get().n
  assert.ok(ttlSeconds > 0)

  await check('1. a plain read alone fills the empty slot under its START time, and the next plain read is served from it', async () => {
    at(T)
    assert.ok(knownKey, 'the priming read stored an inventory entry')
    const first = await plain()
    base = inventoryCount(first)
    assert.equal(base, baseCount())
    assert.equal((await stored()).at, T, 'the entry is stamped with the start')
    at(T + 500)
    const second = await plain()
    assert.equal(inventoryCount(second), base)
    assert.equal(second.json.generatedAt, new Date(T).toISOString(), 'served from the entry: as of its start')
  })

  await check('2. P starts, a write lands, F recomputes and stores, P finishes: P must NOT overwrite F (N-C1)', async () => {
    at(T)
    const stale = baseCount()
    const park = parkProducer()
    const p = plain()
    await park.reached
    await write()
    at(T + 2000)
    const f = await fresh()
    assert.equal(inventoryCount(f), stale + 1, 'F read the data after the write')
    assert.equal((await stored()).at, T + 2000)
    park.release()
    const pDone = await p
    assert.equal(inventoryCount(pDone), stale, 'control: P itself was computed from the old rows')
    const entry = await stored()
    assert.equal(entry.at, T + 2000, 'the later start stays')
    assert.equal(entry.value.count, stale + 1)
    at(T + 2500)
    const next = await plain()
    assert.equal(inventoryCount(next), stale + 1, 'the next plain read shows the resolved alert as resolved')
    assert.equal(next.json.generatedAt, new Date(T + 2000).toISOString())
  })

  await check('3. P starts and stores, then a write, then F: F started later, so F overwrites', async () => {
    at(T)
    const before = baseCount()
    await plain()
    assert.equal((await stored()).at, T)
    await write()
    at(T + 2000)
    const f = await fresh()
    assert.equal(inventoryCount(f), before + 1)
    const entry = await stored()
    assert.equal(entry.at, T + 2000)
    assert.equal(entry.value.count, before + 1)
  })

  await check('4. the write came first, F started before P: the later START (P) wins whichever finishes first; both include the write', async () => {
    await write()
    const after = baseCount()
    at(T)
    const parkF = parkProducer()
    const f = fresh()
    await parkF.reached
    at(T + 1)
    const p = await plain()
    assert.equal(inventoryCount(p), after)
    assert.equal((await stored()).at, T + 1)
    parkF.release()
    await f
    const entry = await stored()
    assert.equal(entry.at, T + 1, 'F (started earlier) did not overwrite P')
    assert.equal(entry.value.count, after)
  })

  await check('5. equal start times: the held producer still writes (the comparison is strict)', async () => {
    at(T)
    const stale = baseCount()
    const park = parkProducer()
    const held = plain()
    await park.reached
    await write()
    const second = await plain()
    assert.equal(inventoryCount(second), stale + 1)
    assert.equal((await stored()).at, T)
    park.release()
    await held
    const entry = await stored()
    assert.equal(entry.at, T)
    assert.equal(entry.value.count, stale, 'same millisecond: the held one wrote (either value is acceptable; the rule is strict)')
  })

  await check('6. a stored entry that is unreadable or has no time never blocks the write', async () => {
    const key = knownKey
    for (const body of ['not json at all', JSON.stringify({ value: { count: 999 } })]) {
      reset()
      at(T)
      const park = parkProducer()
      const p = plain()
      await park.reached
      assert.equal(inventoryKey(), undefined, 'control: the slot was empty when P started')
      cacheStore.set(key, new Response(body))
      park.release()
      await p
      const after = await stored()
      assert.equal(after.at, T, 'the entry was rewritten under the start time')
      assert.equal(after.value.count, baseCount())
    }
  })

  await check('7. a newer stored entry that has expired: the put is skipped and the slot then reads as empty, so the next plain read recomputes', async () => {
    at(T)
    const park = parkProducer()
    const p = plain()
    await park.reached
    at(T + 1500)
    await plain()
    assert.equal((await stored()).at, T + 1500)
    park.release()
    await p
    assert.equal((await stored()).at, T + 1500, 'skipped')
    const expiredAt = T + 1500 + ttlSeconds * 1000 + 1
    at(expiredAt)
    const next = await plain()
    assert.equal(inventoryCount(next), baseCount())
    assert.equal((await stored()).at, expiredAt, 'the expired entry was replaced by a recompute')
  })

  await check('8. KNOWN RESIDUAL (spec B1 case 8): P\'s match sees nothing, F\'s put lands, then P\'s put overwrites it; the window is one match-to-put gap', async () => {
    at(T)
    const stale = baseCount()
    const matchPark = { reached: deferred(), release: deferred() }
    afterInventoryRows = async () => { parkNextInventoryMatch = matchPark }
    const p = plain()
    await matchPark.reached.promise
    await write()
    at(T + 2000)
    const f = await fresh()
    assert.equal(inventoryCount(f), stale + 1)
    assert.equal((await stored()).at, T + 2000)
    matchPark.release.resolve()
    await p
    const entry = await stored()
    assert.equal(entry.at, T, 'the residual: the older computation overwrote the newer one')
    assert.equal(entry.value.count, stale)
    // Its true start time is what stays, so any device whose timer fires at or after the event + the lifetime is past it.
    at(T + ttlSeconds * 1000 + 1)
    const later = await plain()
    assert.equal(inventoryCount(later), stale + 1, 'a read at or after the lifetime recomputes and shows the write')
  })

  await check('B5. a busy shop (a data version moves during every producer, 20 rounds): the slot holds an entry after each round', async () => {
    for (let round = 0; round < 20; round += 1) {
      reset()
      at(T + round * (ttlSeconds * 1000 + 1000))
      afterInventoryRows = async () => { await cacheModule.bumpVersion(env, 'sales'); await cacheModule.bumpVersion(env, 'stock') }
      const res = await plain(ADMIN)
      assert.equal(res.status, 200)
      const entry = await stored()
      assert.ok(entry, `round ${round}: the slot is filled`)
      assert.equal(entry.at, clock.t)
    }
  })

  await check('C2. the stored time and the as-of are the START: a producer that takes 5 s still reads as t0', async () => {
    at(T)
    afterInventoryRows = async () => { at(T + 5000) }
    const res = await plain()
    assert.equal((await stored()).at, T, 'the entry says when the data was read, not when the run ended')
    at(T + 6000)
    const next = await plain()
    assert.equal(next.json.generatedAt, new Date(T).toISOString())
    assert.equal(res.status, 200)
  })

  Date.now = realNow
  console.log(`test-bell-cache-write-order-pure: ${passed} checks passed`)
}

main().then(() => process.exit(0), (error) => { Date.now = realNow; console.error(error); process.exit(1) })
