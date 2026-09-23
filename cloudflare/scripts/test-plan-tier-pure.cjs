// lib/planTier.ts -- the one place that decides free vs paid.
//
// What is actually at risk here, and therefore what this pins:
//
//  1. The DEFAULT. A deployment with no PLAN_TIER var (every deployment that
//     predates this module, and any future config that forgets it) must run
//     as PAID. Defaulting the other way silently shrinks production's import
//     chunks, stock-action ceilings and backup caps at the next isolate cold
//     start, with no config change and no deploy.
//  2. The tier is never INFERRED. An env missing IMPORT_QUEUE, or missing
//     every binding, is still 'paid' unless PLAN_TIER says otherwise.
//  3. Both tables' exact numbers, so a "harmless" edit to one of them is a
//     visible diff here rather than a behaviour change discovered in
//     production.
//  4. The POSITIVE CONTROL. Checks 1-3 all pass if the two tables are
//     identical -- a table-comparison test that reports the same answer for
//     every field cannot tell a working split from a broken one. So this file
//     also asserts that every non-informational field actually DIFFERS
//     between free and paid, and that free is never the more generous of the
//     two. That is the assertion that fails if someone "fixes" free by
//     copying the paid numbers into it.
//
// Run: node scripts/test-plan-tier-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

function loadPlanTier() {
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', 'planTier.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'planTier.ts',
  })
  const moduleObj = { exports: {} }
  // planTier.ts is runtime-dependency-free by design (its only import is
  // `import type`, which transpiles away), so there is nothing to stub --
  // any require() reaching this shim means that property was lost.
  const requireShim = (request) => {
    throw new Error(`planTier.ts must have no runtime dependencies, but required ${request}`)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, requireShim, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  return moduleObj.exports
}

const planTier = loadPlanTier()
const { resolvePlanTier, getPlanLimits, PLAN_LIMITS_BY_TIER, __resetPlanTierCacheForTests } = planTier

function resolveFresh(env) {
  __resetPlanTierCacheForTests()
  return resolvePlanTier(env)
}
function limitsFresh(env) {
  __resetPlanTierCacheForTests()
  return getPlanLimits(env)
}

check('the module exposes exactly the four entry points call sites use', async () => {
  assert.equal(typeof resolvePlanTier, 'function')
  assert.equal(typeof getPlanLimits, 'function')
  assert.equal(typeof __resetPlanTierCacheForTests, 'function')
  assert.ok(PLAN_LIMITS_BY_TIER && PLAN_LIMITS_BY_TIER.free && PLAN_LIMITS_BY_TIER.paid)
})

check('an unset, empty or unknown PLAN_TIER resolves to paid', async () => {
  assert.equal(resolveFresh({}), 'paid', 'unset must never shrink a running production deployment')
  assert.equal(resolveFresh({ PLAN_TIER: '' }), 'paid')
  assert.equal(resolveFresh({ PLAN_TIER: '   ' }), 'paid')
  assert.equal(resolveFresh({ PLAN_TIER: 'FREEE' }), 'paid', 'a typo must fail safe towards paid, not free')
  assert.equal(resolveFresh({ PLAN_TIER: 'enterprise' }), 'paid')
  assert.equal(resolveFresh({ PLAN_TIER: null }), 'paid')
  assert.equal(resolveFresh({ PLAN_TIER: undefined }), 'paid')
  assert.equal(resolveFresh(null), 'paid', 'a missing env must not throw inside a limit read')
  assert.equal(resolveFresh(undefined), 'paid')
})

check('only an explicit free value resolves to free, case- and space-insensitively', async () => {
  assert.equal(resolveFresh({ PLAN_TIER: 'free' }), 'free')
  assert.equal(resolveFresh({ PLAN_TIER: 'FREE' }), 'free')
  assert.equal(resolveFresh({ PLAN_TIER: ' Free ' }), 'free')
  assert.equal(resolveFresh({ PLAN_TIER: 'paid' }), 'paid')
  assert.equal(resolveFresh({ PLAN_TIER: 'PAID' }), 'paid')
})

check('the tier is never inferred from which bindings are present', async () => {
  // A deployment can lose a binding for reasons that have nothing to do with
  // its plan (Queues work on free; a paid deploy can drop a producer). If
  // binding presence fed the tier, one missing binding would silently shrink
  // every unrelated ceiling in the app.
  assert.equal(resolveFresh({ DB: {}, ASSETS: {}, CACHE: {} }), 'paid', 'no queues bound, still paid')
  assert.equal(resolveFresh({ PLAN_TIER: 'free', DB: {}, IMPORT_QUEUE: {}, MEDIA_QUEUE: {}, BACKUP_QUEUE: {} }), 'free',
    'every binding present, still free, because PLAN_TIER says so')
})

check('the tier is cached per isolate and the reset hatch clears it', async () => {
  __resetPlanTierCacheForTests()
  assert.equal(resolvePlanTier({ PLAN_TIER: 'free' }), 'free')
  // Same isolate, different env object: the cached answer wins, which is the
  // documented behaviour (PLAN_TIER is a deploy-time constant, so a real
  // isolate only ever sees one value).
  assert.equal(resolvePlanTier({ PLAN_TIER: 'paid' }), 'free')
  __resetPlanTierCacheForTests()
  assert.equal(resolvePlanTier({ PLAN_TIER: 'paid' }), 'paid')
})

check('getPlanLimits returns the table for the resolved tier', async () => {
  assert.equal(limitsFresh({ PLAN_TIER: 'free' }), PLAN_LIMITS_BY_TIER.free)
  assert.equal(limitsFresh({ PLAN_TIER: 'paid' }), PLAN_LIMITS_BY_TIER.paid)
  assert.equal(limitsFresh({}), PLAN_LIMITS_BY_TIER.paid)
  assert.equal(PLAN_LIMITS_BY_TIER.free.tier, 'free')
  assert.equal(PLAN_LIMITS_BY_TIER.paid.tier, 'paid')
})

// The exact tables. Every number here also exists at a call site; the two are
// kept in step by the call-site tests, and by this file failing loudly if a
// table is edited without the reader being reconsidered.
const PAID = {
  tier: 'paid',
  rowsPerImportChunk: 600,
  preflightMaxRows: 500,
  stockActionMaxUnits: 480,
  stockActionMaxRows: 1920,
  stockActionAddConcurrency: 12,
  historicalSalesImportConcurrency: 12,
  bulkDeleteChunkSize: 500,
  maxAssetsPerBackup: 100,
  scheduledBackupEnabled: true,
  maxImageDeletesPerReset: 500,
  importRetentionMaxJobsPerTier: 20,
  ephemeralDeleteBatch: 5000,
  catalogIntegrityMaxProducts: 50000,
  stockInLinesPerRequest: 29,
  d1DailyRowsRead: 833000000,
  d1DailyRowsWritten: 1666000,
  d1MaxDatabaseBytes: 10 * 1024 * 1024 * 1024,
  d1QueriesPerInvocation: 1000,
}
const FREE = {
  tier: 'free',
  rowsPerImportChunk: 150,
  preflightMaxRows: 125,
  stockActionMaxUnits: 60,
  stockActionMaxRows: 480,
  stockActionAddConcurrency: 6,
  historicalSalesImportConcurrency: 6,
  bulkDeleteChunkSize: 125,
  maxAssetsPerBackup: 20,
  scheduledBackupEnabled: false,
  maxImageDeletesPerReset: 40,
  importRetentionMaxJobsPerTier: 5,
  ephemeralDeleteBatch: 1000,
  catalogIntegrityMaxProducts: 2000,
  stockInLinesPerRequest: 1,
  d1DailyRowsRead: 5000000,
  d1DailyRowsWritten: 100000,
  d1MaxDatabaseBytes: 500 * 1024 * 1024,
  d1QueriesPerInvocation: 50,
}

check('the paid table is exactly the numbers production runs today', async () => {
  assert.deepEqual({ ...PLAN_LIMITS_BY_TIER.paid }, PAID)
})

check('the free table is exactly the pre-A4 / platform-sized numbers', async () => {
  assert.deepEqual({ ...PLAN_LIMITS_BY_TIER.free }, FREE)
})

check('both tables carry exactly the same field set, with no extras', async () => {
  const free = Object.keys(PLAN_LIMITS_BY_TIER.free).sort()
  const paid = Object.keys(PLAN_LIMITS_BY_TIER.paid).sort()
  assert.deepEqual(free, paid, 'a field on one tier only is a limit that reads undefined on the other')
  assert.deepEqual(free, Object.keys(FREE).sort(), 'a new field needs a reader and a pin here')
})

// ---- POSITIVE CONTROL -----------------------------------------------------
//
// Without this, every assertion above still passes when the free table is a
// verbatim copy of the paid one -- i.e. when the split does nothing at all.
check('POSITIVE CONTROL: free actually differs from paid, and is never larger', async () => {
  const free = PLAN_LIMITS_BY_TIER.free
  const paid = PLAN_LIMITS_BY_TIER.paid
  const same = []
  for (const key of Object.keys(paid)) {
    if (key === 'tier') continue
    if (free[key] === paid[key]) same.push(key)
    if (typeof paid[key] === 'number') {
      assert.ok(free[key] < paid[key], `free.${key} (${free[key]}) must be strictly smaller than paid.${key} (${paid[key]})`)
    }
  }
  assert.deepEqual(same, [], `these fields are identical on both tiers, so the split does nothing for them: ${same.join(', ')}`)
  // And the control's own control: a deliberately identical pair must be
  // REPORTED as identical, so a green run above cannot come from the
  // comparison silently matching nothing.
  const fakeFree = { ...paid, tier: 'free' }
  const detected = Object.keys(paid).filter((k) => k !== 'tier' && fakeFree[k] === paid[k])
  assert.ok(detected.length > 0, 'the comparison itself must be able to see a copied table')
})

check('a free deployment stays inside the platform ceilings it is sized against', async () => {
  const free = PLAN_LIMITS_BY_TIER.free
  // Free: 50 EXTERNAL subrequests per invocation. A backup asset costs an R2
  // get() + put(); a reset image delete costs one delete.
  assert.ok(free.maxAssetsPerBackup * 2 <= 50, 'a free backup run must fit the 50-subrequest ceiling')
  assert.ok(free.maxImageDeletesPerReset <= 50, 'a free reset image sweep must fit the 50-subrequest ceiling')
  // The whole free table is sized assuming the conservative reading of
  // Cloudflare's contradictory D1 docs. If that assumption is ever revised,
  // it must be revised here and in planTier.ts's comment together.
  assert.equal(free.d1QueriesPerInvocation, 50, 'documented assumption: the conservative of the two published figures')
  assert.equal(free.d1MaxDatabaseBytes, 500 * 1024 * 1024)
  assert.equal(free.scheduledBackupEnabled, false, 'a full D1 backup cannot run inside a 10ms cron invocation')
})

check('planTier.ts imports nothing at runtime', async () => {
  const source = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'planTier.ts'), 'utf8')
  const imports = source.match(/^import .*$/gm) || []
  assert.deepEqual(imports, ["import type { Env } from '../index'"],
    'a runtime import here would make every harness that loads a limit-reading module need a new stub')
  // loadPlanTier() above throws on any require(), so a green run is itself
  // the second, independent proof.
})

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
