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
  paymentMethodScanPageSize: 200,
  maxAssetsPerBackup: 100,
  scheduledBackupEnabled: true,
  maxImageDeletesPerReset: 500,
  importRetentionMaxJobsPerTier: 20,
  ephemeralDeleteBatch: 5000,
  catalogIntegrityMaxProducts: 50000,
  stockInLinesPerRequest: 24,
  stockInLinesPerRequestByCalls: 24,
  callCountingSwitchApplies: false,
  coreInvariantsReverifySeconds: 21600,
  dashboardStockOverviewCacheSeconds: 30,
  dashboardOverviewMaxAgeSeconds: 300,
  readSwitchMemoSeconds: 5,
  buildSharePollMs: 50,
  buildShareWaitMs: 1000,
  buildShareStaleMs: 3000,
  buildShareMemoMaxEntries: 32,
  expenseExportPageRows: 500,
  expenseReportFoldMaxRows: 50000,
  expenseReportFoldUnboundedWindows: true,
  d1DailyRowsRead: 833000000,
  d1DailyRowsWritten: 1666000,
  d1MaxDatabaseBytes: 10 * 1024 * 1024 * 1024,
  d1QueriesPerInvocation: 1000,
  portalAiDailyMax: 300,
  portalAiVisitorDailyMax: 30,
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
  paymentMethodScanPageSize: 5000,
  maxAssetsPerBackup: 20,
  scheduledBackupEnabled: false,
  maxImageDeletesPerReset: 40,
  importRetentionMaxJobsPerTier: 5,
  ephemeralDeleteBatch: 1000,
  catalogIntegrityMaxProducts: 2000,
  stockInLinesPerRequest: 1,
  stockInLinesPerRequestByCalls: 2,
  callCountingSwitchApplies: true,
  coreInvariantsReverifySeconds: 86400,
  dashboardStockOverviewCacheSeconds: 300,
  dashboardOverviewMaxAgeSeconds: 300,
  readSwitchMemoSeconds: 15,
  buildSharePollMs: 100,
  buildShareWaitMs: 2000,
  buildShareStaleMs: 5000,
  buildShareMemoMaxEntries: 16,
  expenseExportPageRows: 500,
  expenseReportFoldMaxRows: 1500,
  expenseReportFoldUnboundedWindows: false,
  d1DailyRowsRead: 5000000,
  d1DailyRowsWritten: 100000,
  d1MaxDatabaseBytes: 500 * 1024 * 1024,
  d1QueriesPerInvocation: 50,
  portalAiDailyMax: 100,
  portalAiVisitorDailyMax: 10,
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

// Read-cost LIFETIMES (planTier.ts "Read-cost lifetimes"): a longer lifetime
// reads fewer D1 rows, so on these Free is deliberately the LARGER number.
// Listed by name so a ceiling can never slip into this exemption unnoticed.
// The buildShare durations (lib/buildShare.ts) are in it too: Free waits longer for the first builder's result because a duplicate build costs
// reads, and polls more coarsely because a Free invocation has 10 ms of CPU. buildShareMemoMaxEntries is a ceiling (Free 16 < Paid 32), so it
// is not in the list. Every one differs between the tiers, so none needs an exemption.
const FREE_IS_LONGER = ['coreInvariantsReverifySeconds', 'dashboardStockOverviewCacheSeconds', 'readSwitchMemoSeconds', 'buildSharePollMs', 'buildShareWaitMs', 'buildShareStaleMs']

// PAGE SIZES (planTier.ts): a page is one D1 call and calls are what Free rations (50 per invocation), so on these Free is
// deliberately the LARGER number; Paid keeps its old size so its reads do not change. Their own list, one line apart from the
// lifetimes above, so a lane that names a new lifetime and a lane that names a new page size never edit the same line.
const FREE_IS_LONGER_PAGE_SIZES = ['paymentMethodScanPageSize']
const FREE_IS_LONGER_ALL = [...FREE_IS_LONGER, ...FREE_IS_LONGER_PAGE_SIZES]

// Fields that are deliberately the SAME number on both tiers, named so the exemption cannot grow unnoticed. The Expenses export asks for 500 rows a page and the
// offset path caps at 500, so a smaller Free page only turned an export of up to 500 rows (a month's: one request today) into two pages that each pay the cursor's
// fixed cost, and made it dearer on exactly the tier that counts reads (E1-F review N2). The Free CPU bound lives in expenseReportFoldMaxRows, which does differ.
// dashboardOverviewMaxAgeSeconds is the owner's own promise (27 Oct / 1 Nov: the Dashboard stock overview is at most 5 minutes old and says when it was calculated), so it is
// the same on both tiers; the read switch dash_overview_5m decides whether it is used, and what Free saves is the recompute a sale used to force.
const SAME_ON_BOTH_TIERS = ['expenseExportPageRows', 'dashboardOverviewMaxAgeSeconds']

// ---- POSITIVE CONTROL -----------------------------------------------------
//
// Without this, every assertion above still passes when the free table is a
// verbatim copy of the paid one -- i.e. when the split does nothing at all.
check('POSITIVE CONTROL: free actually differs from paid; ceilings are smaller, lifetimes longer', async () => {
  const free = PLAN_LIMITS_BY_TIER.free
  const paid = PLAN_LIMITS_BY_TIER.paid
  const same = []
  for (const key of Object.keys(paid)) {
    if (key === 'tier') continue
    if (SAME_ON_BOTH_TIERS.includes(key)) {
      assert.equal(free[key], paid[key], `${key} is named as the same on both tiers, so it must be`)
      continue
    }
    if (free[key] === paid[key]) same.push(key)
    if (typeof paid[key] === 'number' && FREE_IS_LONGER_ALL.includes(key)) {
      assert.ok(free[key] > paid[key], `free.${key} (${free[key]}) is a lifetime and must be strictly LONGER than paid.${key} (${paid[key]})`)
    } else if (typeof paid[key] === 'number') {
      assert.ok(free[key] < paid[key], `free.${key} (${free[key]}) must be strictly smaller than paid.${key} (${paid[key]})`)
    }
  }
  for (const key of FREE_IS_LONGER_ALL) assert.ok(Object.hasOwn(paid, key), `FREE_IS_LONGER names a field that does not exist: ${key}`)
  for (const key of SAME_ON_BOTH_TIERS) assert.ok(Object.hasOwn(paid, key), `SAME_ON_BOTH_TIERS names a field that does not exist: ${key}`)
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
  assert.equal(free.d1MaxDatabaseBytes, 500 * 1024 * 1024)
  assert.equal(free.scheduledBackupEnabled, false, 'a full D1 backup cannot run inside a 10ms cron invocation')
  // The payment-method rename scans every sale, one D1 call per page. About
  // 20 calls go to auth, settings, the revision snapshot, the write batch and
  // the audit read-back; the rest is the scan. 100,000 sales is more than six
  // times the shop's ~16k, and must still fit.
  assert.ok(Math.ceil(100_000 / free.paymentMethodScanPageSize) + 20 <= free.d1QueriesPerInvocation,
    'a free payment-method rename over 100,000 sales must fit the 50-call ceiling')
  assert.ok(Math.ceil(16_000 / PLAN_LIMITS_BY_TIER.paid.paymentMethodScanPageSize) + 20 > free.d1QueriesPerInvocation,
    'control: the PAID page would not fit the Free ceiling (that is why the page is a plan field)')
})

// 6.0.1048 (owner rule, 3 Nov): a Free-sized number is a field here, never a literal at the call site. The switch/epoch memo was one.
check('the switch/epoch memo is a plan field with no literal left at its call sites', async () => {
  const read = (...parts) => fs.readFileSync(path.join(cloudflareRoot, ...parts), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(PLAN_LIMITS_BY_TIER.free.readSwitchMemoSeconds, 15)
  assert.equal(PLAN_LIMITS_BY_TIER.paid.readSwitchMemoSeconds, 5)
  const switches = read('src', 'lib', 'readSwitches.ts')
  assert.match(switches, /getPlanLimits\(env\)\.readSwitchMemoSeconds/, 'the module reads the plan field')
  assert.doesNotMatch(switches, /READ_SWITCH_MEMO_MS|ttlMs\s*=\s*[0-9]|MEMO_MS\s*=\s*[0-9]/, 'no bare window left in the module')
  assert.match(read('src', 'lib', 'dataEpoch.ts'), /readSwitchMemoMs\(env\) \+ EPOCH_SETTLE_MARGIN_MS/, 'the restore settle follows the plan window')
  assert.match(read('src', 'routes', 'runtime.ts'), /memoSeconds: getPlanLimits\(env\)\.readSwitchMemoSeconds/, 'the listing reports the plan window')
})

// The browser cannot read the plan, so its two windows are sized from the LARGEST server memo (Free). This keeps them honest.
check('the client windows cover the longest server memo: the echo window outlasts memo + settle, the signal lifetime is three memos', async () => {
  const frontend = (...parts) => fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'api', ...parts), 'utf8')
  const number = (source, name) => Number(new RegExp(`${name} = ([0-9_]+)`).exec(source)[1].replace(/_/g, ''))
  const longest = Math.max(...Object.values(PLAN_LIMITS_BY_TIER).map((limits) => limits.readSwitchMemoSeconds)) * 1000
  assert.equal(longest, PLAN_LIMITS_BY_TIER.free.readSwitchMemoSeconds * 1000, 'Free holds the longest memo; the client windows are sized from it')
  const echo = number(frontend('dataEpoch.ts'), 'ECHO_WINDOW_MS')
  const signal = number(frontend('serverSignals.ts'), 'SIGNAL_TTL_MS')
  assert.ok(echo >= 2 * longest, `ECHO_WINDOW_MS ${echo} must cover memo + settle (2 x ${longest})`)
  assert.ok(signal >= 3 * longest, `SIGNAL_TTL_MS ${signal} must cover three memos (${3 * longest})`)
})

// 6.0.1048 review B2: a restore and a forced clear wait one memo period (epochSettleMs) before they release writes. On Free that is the
// longest request the app makes on purpose, and the browser must not give up on it.
check('the restore and forced-clear requests outlast the Free settle with room to spare (computed from the plan, not a literal)', async () => {
  const frontend = (...parts) => fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'api', ...parts), 'utf8').replace(/\r\n/g, '\n')
  const margin = Number(/EPOCH_SETTLE_MARGIN_MS = ([0-9_]+)/.exec(fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'dataEpoch.ts'), 'utf8'))[1].replace(/_/g, ''))
  const freeSettle = PLAN_LIMITS_BY_TIER.free.readSwitchMemoSeconds * 1000 + margin
  const timeout = Number(/export const WRITE_REQUEST_TIMEOUT_MS = ([0-9_]+)/.exec(frontend('http.ts'))[1].replace(/_/g, ''))
  assert.ok(freeSettle > 15_000, 'the Free settle is the figure the review measured (about 16 s)')
  assert.ok(timeout > freeSettle, `WRITE_REQUEST_TIMEOUT_MS ${timeout} must exceed the Free settle ${freeSettle}`)
  assert.ok(timeout >= 2 * freeSettle, `and leave room for the password check, the epoch write and the release: at least 2 x ${freeSettle}`)
  const sync = Number(/REQUEST_TIMEOUT_MS: ([0-9_]+)/.exec(fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'constants.ts'), 'utf8'))[1].replace(/_/g, ''))
  assert.ok(sync < freeSettle, 'control: the ordinary request timeout IS shorter than the settle, which is why these two calls must not use it')
  const jobs = frontend('systemJobs.ts')
  assert.match(jobs, /'\/api\/backups\/maintenance\/clear', \{ force: true, currentPassword \}, WRITE_REQUEST_TIMEOUT_MS\)/, 'the forced clear')
  assert.match(jobs, /type: 'import-folder',[\s\S]*?\}, WRITE_REQUEST_TIMEOUT_MS\)/, 'the restore')
})

// 6.0.1048 (delta review): the Backup page races the restore request against a timer of its own (withLoaderTimeout). On Free the server
// answers after 16 s or more, so that timer must be at least the transport timeout, which is at least twice the Free settle. The numbers are
// resolved from the sources (a constant may be written as another constant plus a margin), never retyped here.
check('the Backup page does not give up on a restore before the transport does: UI race >= transport >= 2 x the Free settle', async () => {
  const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8').replace(/\r\n/g, '\n')
  const frontend = path.join(cloudflareRoot, '..', 'frontend', 'src')
  const sources = [
    read(frontend, 'components', 'utils-settings', 'Backup.tsx'),
    read(frontend, 'api', 'systemJobs.ts'),
    read(frontend, 'api', 'http.ts'),
    read(frontend, 'constants.ts'),
  ]
  const resolve = (name, depth = 0) => {
    assert.ok(depth < 6, `${name}: constant chain too deep`)
    for (const source of sources) {
      const match = new RegExp(`(?:export )?const ${name}(?::[^=]+)? = ([^\\n]+)`).exec(source)
      if (!match) continue
      const expression = match[1].replace(/\/\/.*$/, '').trim()
      return expression.split('+').map((term) => term.trim()).reduce((sum, term) => sum + (/^[0-9_]+$/.test(term) ? Number(term.replace(/_/g, '')) : resolve(term, depth + 1)), 0)
    }
    throw new Error(`constant ${name} not found`)
  }
  const call = /'Queue backup restore',\s*([A-Za-z_]+),?\s*\)/.exec(sources[0])
  assert.ok(call, 'the restore call in Backup.tsx is found')
  const uiRace = resolve(call[1])
  const transport = resolve('WRITE_REQUEST_TIMEOUT_MS')
  const margin = Number(/EPOCH_SETTLE_MARGIN_MS = ([0-9_]+)/.exec(read(cloudflareRoot, 'src', 'lib', 'dataEpoch.ts'))[1].replace(/_/g, ''))
  const freeSettle = PLAN_LIMITS_BY_TIER.free.readSwitchMemoSeconds * 1000 + margin
  assert.ok(uiRace >= transport, `the restore's UI race (${call[1]} = ${uiRace}) must be at least the transport timeout (${transport}), or the page says "took longer" for a restore that succeeds`)
  assert.ok(transport >= 2 * freeSettle, `the transport timeout ${transport} must be at least twice the Free settle ${freeSettle}`)
})

// Free's per-invocation D1 budget. The D1 limits page (updated 24 Oct 2026)
// says 1000 (Paid) / 50 (Free) QUERIES per invocation and that a db.batch() is
// ONE query. The Workers page's 1,000 internal-services figure does not
// override it, so Free stays 50 (a 27 Oct change to 900 was reverted). The unit
// is calls: see scripts/test-call-counting-pure.cjs.
check('free d1QueriesPerInvocation is the D1 page figure, 50 calls', async () => {
  assert.equal(PLAN_LIMITS_BY_TIER.free.d1QueriesPerInvocation, 50)
  assert.equal(PLAN_LIMITS_BY_TIER.paid.d1QueriesPerInvocation, 1000)
})

check('no test or harness keeps its own literal copy of a plan query budget', async () => {
  const scripts = path.join(cloudflareRoot, 'scripts')
  const files = [
    ...fs.readdirSync(scripts).filter((n) => /^test-.*\.cjs$/.test(n)).map((n) => path.join(scripts, n)),
    ...fs.readdirSync(path.join(scripts, 'harness')).filter((n) => n.endsWith('.cjs')).map((n) => path.join(scripts, 'harness', n)),
  ]
  const literal = /\b(?:FREE|PAID)_QUERY_LIMIT\s*=\s*\d/
  const offenders = files.filter((f) => literal.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(scripts, f))
  assert.deepEqual(offenders, [], 'read the budget from harness/plan_query_limits.cjs, which reads planTier.ts')
  const helper = require(path.join(scripts, 'harness', 'plan_query_limits.cjs'))
  assert.equal(helper.FREE_QUERY_LIMIT, PLAN_LIMITS_BY_TIER.free.d1QueriesPerInvocation)
  assert.equal(helper.PAID_QUERY_LIMIT, PLAN_LIMITS_BY_TIER.paid.d1QueriesPerInvocation)
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
