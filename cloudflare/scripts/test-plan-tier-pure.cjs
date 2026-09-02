// planTier.ts: the one place that decides Free vs Paid plan-sensitive
// constants (import chunk sizes, stock-action ceilings, backup/reset batch
// caps -- see that module's header for the full "why").
//
// Three things would be catastrophic to get wrong here, silently:
//   1. An unset env.PLAN_TIER defaulting to 'free' -- production's
//      wrangler.toml does not currently set this var at all, so that would
//      shrink every one of today's Paid-sized ceilings on the next cold
//      start, with no config change and no deploy.
//   2. The Free/Paid numbers drifting from what wrangler.toml's own
//      historical comments and each constant's definition-site comment
//      document -- this file exists specifically so a future edit to
//      either PAID_LIMITS or FREE_LIMITS trips a test, not a production
//      incident.
//   3. The isolate-level cache reading env.PLAN_TIER more than once per
//      cold start not actually caching -- re-reading is harmless by
//      itself, but the whole point of caching is documented as "safe
//      because it's a deploy-time constant", so this pins that the cache
//      really does stick.
//
// Run: node scripts/test-plan-tier-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('default (unset PLAN_TIER) is paid -- never silently free', async () => {
  const { getPlanTier, getPlanLimits, __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({}), 'paid')
  assert.equal(getPlanLimits({}).tier, 'paid')
})

check('empty string / whitespace-only PLAN_TIER also defaults to paid', async () => {
  const { getPlanTier, __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({ PLAN_TIER: '' }), 'paid')
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({ PLAN_TIER: '   ' }), 'paid')
})

check('an unrecognized PLAN_TIER value defaults to paid, not free', async () => {
  const { getPlanTier, __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({ PLAN_TIER: 'enterprise' }), 'paid')
})

check('PLAN_TIER=free is recognized case-insensitively and trimmed', async () => {
  const { getPlanTier, __resetPlanTierCacheForTests } = await loadPlanTier()
  for (const raw of ['free', 'FREE', 'Free', '  free  ', '\tfree\n']) {
    __resetPlanTierCacheForTests()
    assert.equal(getPlanTier({ PLAN_TIER: raw }), 'free', `expected ${JSON.stringify(raw)} -> free`)
  }
})

check('getPlanTier is cached per isolate -- a later env is ignored until reset', async () => {
  const { getPlanTier, __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({ PLAN_TIER: 'free' }), 'free', 'first read wins')
  assert.equal(getPlanTier({ PLAN_TIER: 'paid' }), 'free', 'cached -- a different env must NOT change the answer')
  assert.equal(getPlanTier({}), 'free', 'still cached even against an env with no PLAN_TIER at all')
  __resetPlanTierCacheForTests()
  assert.equal(getPlanTier({ PLAN_TIER: 'paid' }), 'paid', 'reset clears the cache so the next read wins again')
})

check('getPlanLimits follows getPlanTier and matches PLAN_LIMITS_BY_TIER exactly', async () => {
  const { getPlanLimits, PLAN_LIMITS_BY_TIER, __resetPlanTierCacheForTests } = await loadPlanTier()
  __resetPlanTierCacheForTests()
  assert.deepEqual(getPlanLimits({ PLAN_TIER: 'paid' }), PLAN_LIMITS_BY_TIER.paid)
  __resetPlanTierCacheForTests()
  assert.deepEqual(getPlanLimits({ PLAN_TIER: 'free' }), PLAN_LIMITS_BY_TIER.free)
})

// Pin the exact numbers documented in planTier.ts's own comments (which in
// turn cite wrangler.toml's A4 subrequest re-base table and each
// constant's own definition-site history in importEngine.ts/backup.ts/
// system.ts). A future edit that changes a number here without updating
// this test, or vice versa, is exactly the drift this file exists to catch.
check('Paid limits match the current exported constants at their definition sites', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  assert.deepEqual(PLAN_LIMITS_BY_TIER.paid, {
    tier: 'paid',
    rowsPerImportChunk: 600,
    preflightMaxRows: 500,
    stockActionMaxUnits: 480,
    stockActionMaxRows: 1920,
    maxAssetsPerBackup: 100,
    maxImageDeletesPerReset: 500,
    importQueueMaxBatchSize: 5,
    longAiImagePassesEnabled: true,
    d1DailyRowsReadCeiling: 833_000_000,
    d1DailyRowsWrittenCeiling: 1_666_000,
  })
})

check('Free limits match the documented Free-era / platform-fact values', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  assert.deepEqual(PLAN_LIMITS_BY_TIER.free, {
    tier: 'free',
    rowsPerImportChunk: 150,
    preflightMaxRows: 125,
    stockActionMaxUnits: 60,
    stockActionMaxRows: 480,
    maxAssetsPerBackup: 20,
    maxImageDeletesPerReset: 200,
    importQueueMaxBatchSize: 1,
    longAiImagePassesEnabled: false,
    d1DailyRowsReadCeiling: 5_000_000,
    d1DailyRowsWrittenCeiling: 100_000,
  })
})

// Cross-check against wrangler.free.toml's actual [vars] and queue consumer
// settings, so the two files cannot silently drift apart from each other --
// planTier.ts documents importQueueMaxBatchSize as "informational only,
// mirrors wrangler config"; this proves the mirror is accurate.
// Locates the business-os-import CONSUMER stanza specifically (not the
// producer block, which declares the same queue name earlier in the file)
// and reads its max_batch_size off an actual assignment line -- not a
// comment mentioning the number in prose, which several of these stanzas'
// reasoning comments do (e.g. "max_batch_size=5 would silently repack...").
function importConsumerMaxBatchSize(toml) {
  const marker = '[[queues.consumers]]\nqueue = "business-os-import"\n'
  const start = toml.indexOf(marker)
  assert.ok(start >= 0, 'business-os-import consumer stanza not found')
  const stanza = toml.slice(start, toml.indexOf('\n\n', start))
  const line = stanza.match(/^max_batch_size = (\d+)$/m)
  assert.ok(line, 'business-os-import consumer has no max_batch_size assignment line')
  return Number(line[1])
}

// wrangler.toml (checked in with CRLF, Windows-authored) and wrangler.free.toml
// (LF) must both parse the same way regardless of which line ending either
// happens to use -- normalize before scanning rather than depending on it.
function readTomlNormalized(name) {
  return fs.readFileSync(path.join(cloudflareRoot, name), 'utf8').replace(/\r\n/g, '\n')
}

check('wrangler.free.toml sets PLAN_TIER=free and matches importQueueMaxBatchSize', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  const freeToml = readTomlNormalized('wrangler.free.toml')
  assert.match(freeToml, /\nPLAN_TIER\s*=\s*"free"/, 'wrangler.free.toml must set PLAN_TIER = "free"')
  assert.equal(
    importConsumerMaxBatchSize(freeToml),
    PLAN_LIMITS_BY_TIER.free.importQueueMaxBatchSize,
    'planTier.ts\'s informational importQueueMaxBatchSize must mirror the real wrangler.free.toml consumer setting',
  )
})

check('wrangler.toml (Paid) sets PLAN_TIER=paid and matches importQueueMaxBatchSize', async () => {
  const { PLAN_LIMITS_BY_TIER } = await loadPlanTier()
  const paidToml = readTomlNormalized('wrangler.toml')
  assert.match(paidToml, /\nPLAN_TIER\s*=\s*"paid"/, 'wrangler.toml must pin PLAN_TIER = "paid" explicitly')
  assert.equal(importConsumerMaxBatchSize(paidToml), PLAN_LIMITS_BY_TIER.paid.importQueueMaxBatchSize)
})

// Transpile the REAL module, same pattern as test-quota-guard-pure.cjs --
// reimplementing the tier logic here would test this file's copy, not the
// real one. planTier.ts's only import is `import type { Env } from
// '../index'`, which transpileModule erases (type-only), so no require
// shim is actually exercised -- kept anyway so a future non-type import
// added to the module fails loudly here instead of at deploy time.
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
let cachedModule = null
async function loadPlanTier() {
  if (cachedModule) return cachedModule
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', 'planTier.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'planTier.ts',
  })
  const moduleObj = { exports: {} }
  const requireShim = (request) => {
    if (request === '../index') return {}
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, requireShim, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  cachedModule = moduleObj.exports
  return cachedModule
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
