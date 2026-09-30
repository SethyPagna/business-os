// READS-CUT (8): GET /api/notifications/summary is ~10 D1 queries per build and
// every open admin tab re-asked for it on each of nine sync broadcasts. The
// server now keeps a permission-keyed, ~1 s single-flight cache (lib/
// notificationSummaryCache.ts) and the client waits longer than that TTL after
// the last broadcast before it asks (see the pinned pair at the bottom).
//
// The REAL routes/notifications.ts, permissions kernel and migration chain run
// on SQLite; only auth is stubbed and D1 is wrapped by a statement counter.
// NOTIFICATIONS_ROUTE_SOURCE=<file> points the route at another source text
// (e.g. `git show HEAD~:...`) to prove these checks are red without the cache.
//
// Run: node scripts/test-notification-summary-cache-pure.cjs
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { countingDb } = require('./harness/counting_d1.cjs')

const SRC = path.join(__dirname, '..', 'src')
const moduleCache = new Map()
let currentUser = null
let counted = null

const overrides = {
  '../lib/db': { getDb: () => counted.db },
  './db': { getDb: () => counted.db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); return next() } },
}
function load(rel, sourceText) {
  if (!sourceText && moduleCache.has(rel)) return moduleCache.get(rel).exports
  const file = path.join(SRC, rel)
  const output = ts.transpileModule(sourceText ?? fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  if (!sourceText) moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.hasOwn(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const routeOverride = process.env.NOTIFICATIONS_ROUTE_SOURCE
const app = load('routes/notifications.ts', routeOverride ? fs.readFileSync(routeOverride, 'utf8') : undefined).default
const cacheLib = fs.existsSync(path.join(SRC, 'lib', 'notificationSummaryCache.ts')) ? load('lib/notificationSummaryCache.ts') : null

let clock = 1_800_000_000_000
const realNow = Date.now
Date.now = () => clock

const admin = { id: 1, username: 'admin', role_code: 'admin', permissions: '{}', role_permissions: '{"all":true}' }
const clerk = (id) => ({ id, username: `clerk${id}`, role_code: 'employee', permissions: '{}', role_permissions: '{"sales":true}' })
const buyer = { id: 9, username: 'buyer', role_code: 'employee', permissions: '{}', role_permissions: '{"inventory":true,"products":true}' }

function fixture() {
  const raw = openDb(loadAll())
  raw.db.exec(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES (1,'Serum',1,0),(2,'Toner',1,500)`)
  counted = countingDb(raw)
  cacheLib?.clearNotificationSummaryCache()
  return raw
}
async function get(user) {
  currentUser = user
  const res = await app.request('http://local/summary', {}, { DB: {} }, { waitUntil() {} })
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  return body
}
const withoutTime = (body) => ({ ...body, generatedAt: undefined })
const sectionIds = (body) => body.sections.map((section) => section.id)

let passed = 0
let finished = false
// A promise that never settles ends the process with status 0; do not let that read as green.
process.on('exit', () => { if (!finished) { console.error('test did not run to completion'); process.exitCode = 1 } })
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  let perBuild
  await check('baseline: one build of the summary costs a fixed set of D1 statements', async () => {
    fixture()
    const body = await get(admin)
    perBuild = counted.stats.statements
    assert.ok(perBuild >= 8, `expected a multi-query build, got ${perBuild}`)
    assert.ok(sectionIds(body).includes('inventory'), 'the fixture must produce a real inventory section')
  })

  await check('six tabs asking at once share one build', async () => {
    fixture()
    const bodies = await Promise.all([1, 2, 3, 4, 5, 6].map(() => get(admin)))
    assert.strictEqual(counted.stats.statements, perBuild, `6 concurrent asks: ${counted.stats.statements} statements vs ${6 * perBuild} uncached`)
    for (const body of bodies) assert.deepStrictEqual(body, bodies[0])
    console.log(`  6 concurrent tabs: ${6 * perBuild} -> ${counted.stats.statements} statements`)
  })

  await check('an ask inside the TTL is free; one at the TTL rebuilds and sees new data', async () => {
    const raw = fixture()
    await get(admin)
    counted.reset()
    clock += 999
    await get(admin)
    assert.strictEqual(counted.stats.statements, 0, 'age 999 ms is served from memory')
    raw.db.exec(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES (3,'Mask',1,0)`)
    const stale = await get(admin)
    assert.ok(!JSON.stringify(stale).includes('Mask'), 'inside the TTL the new product is not visible yet (the documented bound)')
    clock += 1
    const fresh = await get(admin)
    assert.strictEqual(counted.stats.statements, perBuild, 'age 1000 ms rebuilds once')
    assert.ok(JSON.stringify(fresh).includes('Mask'), 'and the rebuild sees the change')
  })

  await check('a cached admin body is never handed to a user with fewer permissions', async () => {
    fixture()
    const adminBody = await get(admin)
    const clerkBody = await get(clerk(2))
    assert.ok(!sectionIds(clerkBody).includes('inventory'), 'a sales-only clerk gets no inventory section')
    assert.ok(!sectionIds(clerkBody).includes('security') && !sectionIds(clerkBody).includes('supplier_credit'), 'nor admin-only sections')
    assert.ok(sectionIds(adminBody).includes('inventory'))
    // Same bits, different account, inside the TTL: shares the clerk's entry.
    counted.reset()
    const otherClerk = await get(clerk(3))
    assert.strictEqual(counted.stats.statements, 0)
    assert.deepStrictEqual(otherClerk, clerkBody)
    // A different bit pattern gets its own build.
    const buyerBody = await get(buyer)
    assert.ok(counted.stats.statements > 0)
    assert.ok(sectionIds(buyerBody).includes('inventory') && !sectionIds(clerkBody).includes('inventory'))
  })

  await check('cached bodies equal uncached bodies for every permission shape', async () => {
    for (const user of [admin, clerk(2), buyer]) {
      fixture()
      const first = await get(user)
      const cached = await get(user)
      cacheLib?.clearNotificationSummaryCache()
      const uncached = await get(user)
      assert.deepStrictEqual(withoutTime(cached), withoutTime(first))
      assert.deepStrictEqual(withoutTime(uncached), withoutTime(first))
    }
  })

  await check('a failed build is not cached: the next ask rebuilds', async () => {
    fixture()
    counted.db.prepare = () => { throw new Error('D1 unavailable') }
    currentUser = admin
    const logged = console.error
    console.error = () => {}
    const failed = await app.request('http://local/summary', {}, { DB: {} }, { waitUntil() {} }).then((res) => res.status).catch(() => 500)
    console.error = logged
    assert.notStrictEqual(failed, 200)
    fixture()
    const ok = await get(admin)
    assert.ok(Array.isArray(ok.sections))
  })

  if (cacheLib) {
    await check('cache unit: pending builds are joined only while younger than the TTL', async () => {
      cacheLib.clearNotificationSummaryCache()
      let builds = 0
      const releases = []
      const slow = () => { builds++; return new Promise((resolve) => { releases.push(() => resolve(builds)) }) }
      const first = cacheLib.cachedNotificationSummary('k', slow)
      clock += 999
      const joined = cacheLib.cachedNotificationSummary('k', slow)
      void joined
      assert.strictEqual(builds, 1, 'joined inside the TTL')
      clock += 1
      const late = cacheLib.cachedNotificationSummary('k', slow)
      void late
      assert.strictEqual(builds, 2, 'a slow build cannot be joined once it is a TTL old')
      releases.forEach((release) => release()); await first
    })
    await check('cache unit: rejection is shared by joiners, then cleared', async () => {
      cacheLib.clearNotificationSummaryCache()
      let builds = 0
      const boom = async () => { builds++; throw new Error('boom') }
      const a = cacheLib.cachedNotificationSummary('k', boom)
      const b = cacheLib.cachedNotificationSummary('k', boom)
      assert.strictEqual(builds, 1, 'the second caller joined')
      await assert.rejects(a, /boom/)
      await assert.rejects(b, /boom/)
      await new Promise((resolve) => setImmediate(resolve))
      await assert.rejects(cacheLib.cachedNotificationSummary('k', boom), /boom/)
      assert.strictEqual(builds, 2)
    })
    await check('cache unit: bounded size, oldest key evicted', async () => {
      cacheLib.clearNotificationSummaryCache()
      let builds = 0
      for (let i = 0; i < 70; i++) await cacheLib.cachedNotificationSummary(`k${i}`, async () => { builds++; return i })
      await cacheLib.cachedNotificationSummary('k0', async () => { builds++; return 0 })
      assert.strictEqual(builds, 71, 'k0 was evicted and rebuilt; the newest key is still cached')
      await cacheLib.cachedNotificationSummary('k69', async () => { builds++; return 69 })
      assert.strictEqual(builds, 71)
    })
  }

  await check('the server TTL is shorter than the client quiet window, so an event-driven ask is never served stale', async () => {
    const server = fs.readFileSync(path.join(SRC, 'lib', 'notificationSummaryCache.ts'), 'utf8')
    const client = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'shared', 'NotificationCenter.tsx'), 'utf8')
    const ttl = Number(/NOTIFICATION_SUMMARY_TTL_MS = (\d+)/.exec(server)?.[1])
    const quiet = Number(/NOTIFICATION_SUMMARY_SYNC_QUIET_MS = (\d+)/.exec(client)?.[1])
    assert.ok(ttl > 0 && quiet > 0, 'both constants exist')
    assert.ok(ttl + 250 <= quiet, `server TTL ${ttl} ms must be at least 250 ms shorter than the client quiet window ${quiet} ms`)
  })

  Date.now = realNow
  finished = true
  console.log(`test-notification-summary-cache-pure: ${passed} checks passed`)
}

main().catch((error) => { Date.now = realNow; console.error(error); process.exit(1) })
