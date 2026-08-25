// Free-tier quota guard, and the cache-version fallback it exists for.
//
// The problem being guarded is not billing -- there is none on the free plan.
// It is that an exhausted quota makes writes fail SILENTLY, and the write
// that fails most often here is a cache-invalidation bump. When that stops
// advancing, cachedJsonResponse keeps serving the old payload and the shop is
// shown stale stock and prices with nothing on screen saying so. A quota
// ceiling turns into a correctness bug.
//
// KV is the tight one: 1,000 writes/day against D1's 100,000, and
// bumpVersion is called from 31 mutation sites -- all writing the SAME key,
// which KV additionally caps at one write per second.
//
// Run: node scripts/test-quota-guard-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

// Real SQLite with the real migrations -- the quota table and its ON CONFLICT
// upsert are the thing under test, so a fake Map would test nothing.
const MIGRATION_SQLS = loadAll()

function freshEnv() {
  const db = openDb(MIGRATION_SQLS)
  const kv = new Map()
  let kvWrites = 0
  let kvDeletes = 0
  return {
    env: {
      DB: db,
      CACHE: {
        get: async (key) => (kv.has(key) ? kv.get(key) : null),
        put: async (key, value) => { kvWrites += 1; kv.set(key, value) },
        delete: async (key) => { kvDeletes += 1; kv.delete(key) },
      },
    },
    db,
    stats: () => ({ kvWrites, kvDeletes, kvSize: kv.size }),
    kv,
  }
}

check('usage accumulates and the zone escalates as the ceiling approaches', async () => {
  const { consumeQuota, zoneFor } = await loadQuotaGuard()
  const { env } = freshEnv()
  // Zones are pure -- assert the thresholds directly rather than burning
  // 1,000 round trips to reach them.
  assert.equal(zoneFor(0, 1000), 'ok')
  assert.equal(zoneFor(699, 1000), 'ok')
  assert.equal(zoneFor(700, 1000), 'warn', 'the safe zone must begin well below the ceiling')
  assert.equal(zoneFor(899, 1000), 'warn')
  assert.equal(zoneFor(900, 1000), 'critical')
  assert.equal(zoneFor(1000, 1000), 'exhausted')
  assert.equal(zoneFor(5000, 1000), 'exhausted')

  const first = await consumeQuota(env, 'kv_write', 1)
  assert.equal(first.used, 1)
  assert.equal(first.limit, 1000)
  assert.equal(first.zone, 'ok')
  assert.equal(first.allowed, true)
  const second = await consumeQuota(env, 'kv_write', 9)
  assert.equal(second.used, 10, 'counts accumulate within the window')
  assert.equal(second.remaining, 990)
})

check('a broken counter never blocks the app -- it fails OPEN', async () => {
  const { consumeQuota } = await loadQuotaGuard()
  // No DB at all: the guard's own bookkeeping is broken.
  const status = await consumeQuota({ DB: null }, 'kv_write', 1)
  assert.equal(status.allowed, true, 'a guard that takes the app down when ITS bookkeeping breaks is worse than the quota')
  assert.equal(status.zone, 'ok')
})

check('separate resources have separate budgets and windows', async () => {
  const { consumeQuota, windowKeyFor } = await loadQuotaGuard()
  const { env } = freshEnv()
  await consumeQuota(env, 'kv_write', 5)
  const r2 = await consumeQuota(env, 'r2_class_a', 1)
  assert.equal(r2.used, 1, 'r2 usage must not inherit kv usage')
  assert.equal(r2.limit, 1_000_000)
  assert.equal(windowKeyFor('day', new Date('2026-08-26T10:00:00Z')), '2026-08-26')
  assert.equal(windowKeyFor('month', new Date('2026-08-26T10:00:00Z')), '2026-08', 'monthly resources roll over on the 1st')
})

check('a new window starts from zero rather than inheriting yesterday', async () => {
  const { consumeQuota } = await loadQuotaGuard()
  const { env, db } = freshEnv()
  await consumeQuota(env, 'kv_write', 900)
  // Simulate the window rolling over by relabelling today's row as yesterday.
  await db.prepare(`UPDATE quota_usage SET window_key = '2000-01-01' WHERE resource = 'kv_write'`).run({})
  const today = await consumeQuota(env, 'kv_write', 1)
  assert.equal(today.used, 1, 'yesterday must not count against today')
  assert.equal(today.zone, 'ok')
})

// ---------------------------------------------------------------------------
// The fallback is the point. Skipping the bump when the budget runs out would
// BE the bug, not the fix.
// ---------------------------------------------------------------------------
check('under budget, the version advances in KV as before', async () => {
  const { bumpVersion } = await loadCache()
  const ctx = freshEnv()
  await bumpVersion(ctx.env, 'products')
  assert.equal(await ctx.env.CACHE.get('v:products'), '1')
  await bumpVersion(ctx.env, 'products')
  assert.equal(await ctx.env.CACHE.get('v:products'), '2', 'each bump advances it')
  assert.equal(ctx.stats().kvDeletes, 0, 'no fallback while there is headroom')
})

check('once KV is critical the version STILL advances, via D1', async () => {
  const { bumpVersion } = await loadCache()
  const { consumeQuota } = await loadQuotaGuard()
  const ctx = freshEnv()
  await bumpVersion(ctx.env, 'products')
  const before = ctx.stats().kvWrites
  // Push usage into the critical zone.
  await consumeQuota(ctx.env, 'kv_write', 950)
  await bumpVersion(ctx.env, 'products')

  const row = await ctx.db
    .prepare(`SELECT version FROM cache_versions WHERE namespace = 'products'`)
    .get({})
  assert.ok(row && Number(row.version) >= 1, 'the bump must land in D1 rather than being dropped')
  assert.equal(ctx.stats().kvWrites, before, 'no further KV writes are spent once critical')
  assert.equal(await ctx.env.CACHE.get('v:products'), null, 'the KV key is removed so readers fall through to D1')
})

check('after crossing over, readers get the D1 version, not a stale KV one', async () => {
  const { bumpVersion, getVersionWithFallback } = await loadCache()
  const { consumeQuota } = await loadQuotaGuard()
  const ctx = freshEnv()
  await bumpVersion(ctx.env, 'products')
  const kvVersion = await getVersionWithFallback(ctx.env, 'products')
  assert.equal(kvVersion, '1', 'KV is preferred while it is present')

  await consumeQuota(ctx.env, 'kv_write', 950)
  await bumpVersion(ctx.env, 'products')
  await bumpVersion(ctx.env, 'products')
  const d1Version = await getVersionWithFallback(ctx.env, 'products')
  assert.equal(d1Version, '2', 'reads now come from D1 and keep advancing')
  assert.notEqual(d1Version, kvVersion, 'the version genuinely changed -- otherwise caches would never invalidate')
})

check('an unexpected KV write failure also falls back rather than going stale', async () => {
  const { bumpVersion } = await loadCache()
  const ctx = freshEnv()
  // Budget says fine, but the real KV rejects the write -- the per-key
  // one-write-per-second limit, for instance.
  ctx.env.CACHE.put = async () => { throw new Error('KV put rate limited') }
  await bumpVersion(ctx.env, 'products')
  const row = await ctx.db
    .prepare(`SELECT version FROM cache_versions WHERE namespace = 'products'`)
    .get({})
  assert.ok(row && Number(row.version) >= 1, 'a KV failure the budget did not predict must still advance the version')
})

check('every bumpVersion call site passes Env, so all 31 are guarded', async () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(p); continue }
      if (!entry.name.endsWith('.ts')) continue
      if (p.endsWith(path.join('lib', 'cache.ts'))) continue
      const content = fs.readFileSync(p, 'utf8')
      if (/bumpVersion\([^)]*\.CACHE\b/.test(content)) offenders.push(p)
    }
  }
  walk(path.join(cloudflareRoot, 'src'))
  assert.deepEqual(offenders, [], `these still pass a bare KVNamespace and would bypass the guard: ${offenders.join(', ')}`)
})

async function loadQuotaGuard() {
  return loadModule('quotaGuard.ts', {})
}
async function loadCache() {
  return loadModule('cache.ts', {})
}

// Transpile the REAL modules against small stubs, same pattern the other
// pure tests use -- reimplementing the rule here would test this file's copy.
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
const loaded = new Map()
function loadModule(name) {
  if (loaded.has(name)) return loaded.get(name)
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', name)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: name,
  })
  const moduleObj = { exports: {} }
  const requireShim = (request) => {
    if (request === './db') return { getDb: (env) => env.DB }
    // Analytics Engine is a no-op without a binding, which is exactly what a
    // test env has -- stubbed so this never depends on the real dataset.
    if (request === './analytics') return { recordAnalytics: () => {} }
    if (request === './quotaGuard') return loadModule('quotaGuard.ts')
    if (request === '../index') return {}
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, requireShim, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  loaded.set(name, moduleObj.exports)
  return moduleObj.exports
}

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()
