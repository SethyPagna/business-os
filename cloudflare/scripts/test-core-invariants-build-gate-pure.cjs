// G39 efficiency item 3: the core-data invariants' stock-coverage scan runs
// once per deployed build, not once per cold isolate -- and still heals.
//
// Real migration chain on node:sqlite behind a D1-shaped adapter that records
// every statement. Each "isolate" is a fresh transpile of the module (fresh
// per-isolate memo) sharing one database, which is exactly what concurrent
// cold isolates of one build look like to D1.
//
// Discrimination: the legacy per-isolate wrapper (ensureCoreDataInvariantsOnce,
// still what unstamped builds use) runs the FULL scan in every cold isolate;
// that count is asserted as the control next to the gate's count of one.
//
// Run: node scripts/test-core-invariants-build-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '../src')
function load(rel, overrides = {}) {
  const filename = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const dbModule = load('lib/db.ts', { './importMaintenanceFence': {} })
const deps = () => ({
  './productStockGuard': load('lib/productStockGuard.ts'),
  './db': dbModule,
  './sqlBinding': load('lib/sqlBinding.ts'),
  './customTableName': load('lib/customTableName.ts'),
  // E6 moved the admin-seed hash into lib/passwordHash (same stub as the sibling core-data tests).
  './passwordHash': { hashPassword: async () => 'focused-test-hash' },
})
// One fresh module instance = one cold isolate.
const isolate = () => load('lib/coreDataInvariants.ts', deps())

// The unbounded scan (every active product) vs the bounded one the gate runs
// per cold isolate (only ids above the recorded watermark).
const FULL_SCAN = /p\.is_active = 1\s+AND p\.id NOT IN \(SELECT product_id FROM branch_stock\)/
const BOUNDED_SCAN = /p\.id > json_extract\(system_flags\.value, '\$\.watermark'\)/
const isFullScan = (sql) => FULL_SCAN.test(sql) && !BOUNDED_SCAN.test(sql)

const migrations = loadAll()
const identity = { BUSINESS_OS_ORGANIZATION_NAME: 'Test OS', BUSINESS_OS_ORGANIZATION_SLUG: 'test-os', BUSINESS_OS_ADMIN_PASSWORD: 'test-password' }
function world() {
  const raw = new DatabaseSync(':memory:')
  for (const sql of migrations) raw.exec(sql)
  // D1 parses with expression depth 100 (harness/d1compat.cjs); so does this fixture.
  raw.limits.exprDepth = 100
  const log = []
  const control = { failOn: null, gate: null }
  const DB = { prepare(sql) {
    return { bind(...values) {
      const enter = async (kind) => {
        log.push({ kind, sql })
        if (control.gate) await control.gate
        if (control.failOn && control.failOn.test(sql)) throw new Error('injected D1 failure')
      }
      return {
        async first() { await enter('read'); return raw.prepare(sql).get(...values) ?? null },
        async all() { await enter('read'); return { results: raw.prepare(sql).all(...values) } },
        async run() {
          await enter('write')
          const result = raw.prepare(sql).run(...values)
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      }
    } }
  } }
  return { raw, log, control, env: { DB, ...identity } }
}
async function seeded() {
  const w = world()
  await isolate().ensureCoreDataInvariants(w.env)
  w.raw.exec(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES(100,'Covered',1,7),(101,'Inactive',0,0),(102,'Covered too',1,3);
    INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 100,id,7 FROM branches WHERE is_default=1;
    INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 102,id,3 FROM branches WHERE is_default=1;`)
  w.log.length = 0
  return w
}
const HOUR = 60 * 60 * 1000
let clockMs = Date.UTC(2026, 9, 5, 12)
const opts = (extra = {}) => ({ buildKey: 'abc1234:hash1', reverifyAfterMs: 24 * HOUR, now: () => clockMs, ...extra })
const fullScans = (w) => w.log.filter((e) => isFullScan(e.sql)).length
const writes = (w) => w.log.filter((e) => e.kind === 'write').length
const flag = (w) => {
  const row = w.raw.prepare("SELECT value FROM system_flags WHERE key='core_invariants_build'").get()
  return row ? JSON.parse(row.value) : null
}
const stockRows = (w, id) => w.raw.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=?').get(id).n

let passed = 0
async function check(name, fn) { await fn(); passed++; console.log('PASS', name) }

async function main() {
  await check('CONTROL: the legacy per-isolate wrapper runs the full scan in EVERY cold isolate', async () => {
    const w = await seeded()
    for (let i = 0; i < 5; i++) await isolate().ensureCoreDataInvariantsOnce(w.env)
    assert.equal(fullScans(w), 5, 'five cold isolates, five full scans (the cost being removed)')
    assert.equal(writes(w), 0)
  })

  await check('five sequential cold isolates of one build: ONE full scan, then verified with no scan', async () => {
    const w = await seeded()
    const outcomes = [await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts())]
    const afterFirst = w.log.length
    for (let i = 0; i < 4; i++) outcomes.push(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()))
    assert.deepEqual(outcomes, ['checked', 'verified', 'verified', 'verified', 'verified'])
    const later = w.log.slice(afterFirst)
    assert.equal(later.length, 8, 'each verified cold isolate: identity projection + flag/bounded probe = 2 statements')
    assert.equal(later.filter((e) => isFullScan(e.sql)).length, 0, 'and neither is the full scan')
    assert.equal(fullScans(w), 1, 'the gate scans once per build')
    const recorded = flag(w)
    assert.equal(recorded.status, 'verified')
    assert.equal(recorded.build, 'abc1234:hash1')
    assert.equal(recorded.watermark, 102, 'watermark = MAX(products.id) read before the scan')
    assert.equal(writes(w), 2, 'one lease write + one record write for the whole build')
  })

  await check('concurrent cold isolates: one takes the lease, the rest defer without scanning', async () => {
    const w = await seeded()
    let release
    w.control.gate = new Promise((resolve) => { release = resolve })
    const runs = Array.from({ length: 6 }, () => isolate().ensureCoreDataInvariantsForBuild(w.env, opts()))
    // Let every isolate finish its first (read) round before any lease lands.
    await new Promise((resolve) => setTimeout(resolve, 20))
    release(); w.control.gate = null
    const outcomes = (await Promise.all(runs)).sort()
    assert.equal(outcomes.filter((o) => o === 'checked').length, 1, `exactly one scan owner (${outcomes})`)
    assert.equal(outcomes.filter((o) => o === 'deferred').length, 5)
    assert.equal(fullScans(w), 1, 'six concurrent cold isolates, one full scan')
    assert.equal(flag(w).status, 'verified')
  })

  await check('a deferred isolate re-checks after the lease window instead of skipping forever', async () => {
    const w = await seeded()
    // Another isolate holds an unexpired lease and then dies without recording.
    w.raw.prepare("INSERT INTO system_flags(key,value) VALUES('core_invariants_build',?)")
      .run(JSON.stringify({ status: 'checking', build: 'abc1234:hash1', until: clockMs + 30_000, token: 'dead' }))
    const mod = isolate()
    assert.equal(await mod.ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'deferred')
    assert.equal(await mod.ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'deferred', 'memoised inside the window')
    assert.equal(fullScans(w), 0)
    clockMs += 31_000
    assert.equal(await mod.ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked', 'expired lease is taken over')
    assert.equal(fullScans(w), 1)
  })

  await check('a product created after the scan WITHOUT branch_stock is healed by the next cold isolate', async () => {
    const w = await seeded()
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked')
    // datedStockCountDecisions.ts-style create: active product, no stock row.
    w.raw.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(200,'New uncovered',1,4)")
    w.log.length = 0
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'repaired')
    assert.equal(stockRows(w, 200), 1, 'backfilled exactly as the per-isolate check did')
    assert.equal(flag(w).status, 'verified', 'the build stays verified; its watermark is still true')
    // Positive control for the bounded probe: a NEW product WITH stock costs no repair.
    w.raw.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(201,'New covered',1,2); INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 201,id,2 FROM branches WHERE is_default=1")
    w.log.length = 0
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'verified')
    assert.equal(writes(w), 0)
    assert.equal(fullScans(w), 0)
  })

  await check('the bounded probe is a primary-key range, not a scan (EXPLAIN QUERY PLAN)', async () => {
    const w = await seeded()
    await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts())
    const probe = w.log.find((e) => BOUNDED_SCAN.test(e.sql)).sql
    // The logged SQL is lib/db.ts's translated (positional) form; a plan needs no bindings.
    const plan = w.raw.prepare(`EXPLAIN QUERY PLAN ${probe}`).all().map((r) => r.detail).join(' | ')
    assert.match(plan, /SEARCH p USING INTEGER PRIMARY KEY \(rowid>\?\)/, plan)
    assert.doesNotMatch(plan, /SCAN p\b/, plan)
  })

  await check('identity drift is still repaired on every cold isolate of a verified build', async () => {
    const w = await seeded()
    await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts())
    w.raw.exec(`UPDATE roles SET permissions='{"all":false}' WHERE code='admin'`)
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'repaired')
    assert.equal(w.raw.prepare("SELECT permissions FROM roles WHERE code='admin'").get().permissions, '{"all":true}')
  })

  await check('coverage lost another way is healed once the verification ages out (bounded, documented)', async () => {
    const w = await seeded()
    await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts())
    w.raw.exec('DELETE FROM branch_stock WHERE product_id=100')
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'verified', 'within the lifetime it is not re-scanned')
    assert.equal(stockRows(w, 100), 0)
    clockMs += 25 * HOUR
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'repaired')
    assert.equal(stockRows(w, 100), 1)
    assert.equal(flag(w), null, 'a repair never certifies: lease dropped, next isolate checks again')
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked')
  })

  await check('a new build re-scans once even though the old build was verified', async () => {
    const w = await seeded()
    await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts())
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts({ buildKey: 'def5678:hash2' })), 'checked')
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts({ buildKey: 'def5678:hash2' })), 'verified')
    assert.equal(fullScans(w), 2)
  })

  await check('a violation at build start is repaired and NOT recorded as verified', async () => {
    const w = await seeded()
    w.raw.exec('DELETE FROM branch_stock WHERE product_id=102')
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'repaired')
    assert.equal(stockRows(w, 102), 1)
    assert.equal(flag(w), null)
  })

  await check('repair fenced by maintenance stays uncertified, so later isolates keep checking', async () => {
    const w = await seeded()
    w.raw.exec(`DELETE FROM branch_stock WHERE product_id=102; INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore","token":"t"}')`)
    for (let i = 0; i < 3; i++) assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'repaired')
    assert.equal(stockRows(w, 102), 0, 'the backfill honours the fence')
    assert.equal(flag(w), null, 'never certified while the violation stands')
    assert.equal(fullScans(w), 6, 'every isolate re-checks (fast path + repair-path rescan), as before the gate')
  })

  await check('FAIL SAFE: flag read failure runs the full check', async () => {
    const w = await seeded()
    w.control.failOn = /AS newUncovered/
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'fallback')
    assert.equal(fullScans(w), 1, 'the check ran instead of being skipped')
  })

  await check('FAIL SAFE: lease write failure runs the full check', async () => {
    const w = await seeded()
    w.control.failOn = /INSERT INTO system_flags/
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'fallback')
    assert.equal(fullScans(w), 1)
    assert.equal(flag(w), null)
  })

  await check('FAIL SAFE: record failure costs only another scan, never a skipped check', async () => {
    const w = await seeded()
    w.control.failOn = /UPDATE system_flags SET value/
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked')
    assert.equal(flag(w).status, 'checking', 'no verification recorded')
    w.control.failOn = null
    clockMs += 31_000
    assert.equal(await isolate().ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked', 'the next isolate scans again')
    assert.equal(fullScans(w), 2)
  })

  await check('a rejected gate is not memoised; malformed flag JSON is replaced', async () => {
    const w = await seeded()
    w.raw.prepare("INSERT INTO system_flags(key,value) VALUES('core_invariants_build','{corrupt')").run()
    const mod = isolate()
    w.control.failOn = /AS adminPermissions/
    // Read failure -> fallback, whose own fast path fails too -> rejection.
    await assert.rejects(mod.ensureCoreDataInvariantsForBuildOnce(w.env, opts()), /injected D1 failure/)
    w.control.failOn = null
    assert.equal(await mod.ensureCoreDataInvariantsForBuildOnce(w.env, opts()), 'checked')
    assert.equal(flag(w).status, 'verified')
  })

  await check('request entry: unstamped builds keep the legacy per-isolate check; stamped builds key on revision:hash', async () => {
    const calls = []
    const gate = load('lib/coreInvariantsGate.ts', {
      './buildStamp': load('lib/buildStamp.ts'),
      './planTier': load('lib/planTier.ts'),
      './coreDataInvariants': {
        ensureCoreDataInvariantsOnce: async () => { calls.push('legacy') },
        ensureCoreDataInvariantsForBuildOnce: async (_env, o) => { calls.push(o) },
      },
    })
    assert.equal(gate.coreInvariantsBuildKey({ revision: 'dev', sourceHash: 'dev', builtAt: '' }), null)
    assert.equal(gate.coreInvariantsBuildKey({ revision: 'abc1234', sourceHash: 'dev', builtAt: '' }), null)
    assert.equal(gate.coreInvariantsBuildKey({ revision: 'abc1234', sourceHash: 'h1', builtAt: 'x' }), 'abc1234:h1')
    await gate.ensureCoreDataInvariantsForRequest({ PLAN_TIER: 'free' })
    assert.deepEqual(calls, ['legacy'], 'this harness build is unstamped')
    const src = fs.readFileSync(path.join(SRC, 'lib/coreInvariantsGate.ts'), 'utf8')
    assert.match(src, /reverifyAfterMs: getPlanLimits\(env\)\.coreInvariantsReverifySeconds \* 1000/)
    const tiers = load('lib/planTier.ts').PLAN_LIMITS_BY_TIER
    assert.ok(tiers.free.coreInvariantsReverifySeconds > tiers.paid.coreInvariantsReverifySeconds, 'Free re-verifies less often')
  })

  await check('index.ts runs the invariants on /api/* only, never on /uploads, /ws, /health', async () => {
    const index = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.match(index, /app\.use\('\/api\/\*', async \(c, next\) => \{\n  await ensureCoreDataInvariantsForRequest\(c\.env\)\n  return next\(\)\n\}\)/)
    assert.doesNotMatch(index, /app\.use\('\*', async \(c, next\) => \{\n  await ensureCoreDataInvariants/)
    assert.doesNotMatch(index, /ensureCoreDataInvariantsOnce/)
    // The same pattern on a real Hono router: which paths reach the middleware.
    const hits = []
    const app = new Hono()
    app.use('/api/*', async (c, next) => { hits.push(c.req.path); return next() })
    for (const p of ['/uploads/a.png', '/ws', '/health', '/api/auth/login', '/api/dashboard/startup']) app.get(p, (c) => c.text('ok'))
    for (const p of ['/uploads/a.png', '/ws', '/health', '/api/auth/login', '/api/dashboard/startup']) await app.request(p)
    assert.deepEqual(hits, ['/api/auth/login', '/api/dashboard/startup'])
  })

  console.log(`\n${passed} core-invariants build-gate checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
