// The surfaces the free/paid split is visible on: the explicit refusals that
// replace a silent truncation, and the one tier readout every client reads.
//
// What is actually at risk here, and therefore what this pins:
//
//  1. SILENT TRUNCATION IS THE BUG. A free deployment that quietly checks the
//     first 125 rows of a 4,000-row file, deletes 40 of 900 image files, or
//     scans 2,000 of 9,000 products and then reports a clean result is worse
//     than one that refuses: the person is told the job was done. Every
//     bounded path here must say so in its own response, with a stable code.
//  2. PAID MUST NOT CHANGE. Each refusal is asserted in BOTH directions --
//     present on free, absent on paid, same input. A check that only ever
//     runs one tier cannot tell a working gate from one that is always on.
//  3. THE READOUT IS THE DEPLOY-TIME VAR, NOT A GUESS. /runtime/version, the
//     auth bootstrap and the integration doctor must all report the same
//     tier, and it must come from PLAN_TIER -- never inferred from which
//     bindings happen to exist.
//  4. THE DOCTOR'S QUEUE CHECK WAS A LIE. It returned `ok: true,
//     'configured'` as a hard-coded literal, so the one screen whose job is
//     to find a broken deployment reported a healthy queue on a deployment
//     with no queue binding at all.
//
// Run: node scripts/test-plan-tier-surfaces-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { Hono } = require('hono')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

function compile(relativePath) {
  const filePath = path.join(srcRoot, relativePath)
  return {
    filePath,
    output: ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filePath,
    }).outputText,
  }
}

function load(relativePath, stubs = {}) {
  const { filePath, output } = compile(relativePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

// planTier is loaded once and shared, because its tier cache is module state:
// every consumer under test has to see the same cache this file clears.
const planTier = load('lib/planTier.ts')
const { resolvePlanTier, getPlanLimits, __resetPlanTierCacheForTests } = planTier

function readSource(relativePath) {
  return fs.readFileSync(path.join(srcRoot, relativePath), 'utf8')
}

// --------------------------------------------------------------------------
// The shared refusal sentence.
// --------------------------------------------------------------------------
check('the free-plan reason is appended only on free', async () => {
  __resetPlanTierCacheForTests()
  assert.equal(planTier.freePlanRefusalSuffix({ PLAN_TIER: 'paid' }), '',
    'a paid deployment must produce byte-identical messages to the ones it produced before the split')
  __resetPlanTierCacheForTests()
  assert.equal(planTier.freePlanRefusalSuffix({}), '', 'unset means paid')
  __resetPlanTierCacheForTests()
  const free = planTier.freePlanRefusalSuffix({ PLAN_TIER: 'free' })
  assert.match(free, /free plan/, 'a refusal a person cannot act on is just an error')
  assert.ok(free.startsWith(' '), 'it is appended to an existing sentence')
})

// --------------------------------------------------------------------------
// Stock import: refuse over the cap, never apply a prefix of the sheet.
// --------------------------------------------------------------------------
check('the stock-import refusals carry a stable code and the tier reason', async () => {
  const engine = readSource('lib/importEngine.ts')
  const coded = engine.match(/code: 'stock_import_over_tier_cap'/g) || []
  assert.equal(coded.length, 2, 'both the reconcile row cap and the single-pass action cap must be coded')
  const suffixed = engine.match(/\$\{freePlanRefusalSuffix\(env\)\}/g) || []
  assert.equal(suffixed.length, 2, 'each refusal must say why the ceiling is what it is')
  // The refusal must be a throw, not a slice: a reconcile import applies
  // deltas against ONE live-stock snapshot, so the first N rows of an
  // oversized sheet are not a partial import, they are a wrong one.
  assert.match(engine, /reconcile mode checks every row against one live-stock snapshot/)
  assert.doesNotMatch(engine, /rows\.slice\(0, limits\.stockActionMaxRows\)/,
    'truncating to the cap would silently apply a wrong reconciliation')
})

// --------------------------------------------------------------------------
// Import preflight: bounded, and it says so.
// --------------------------------------------------------------------------
check('the preflight response names its own cap, its tier and a partial code', async () => {
  const route = readSource('routes/importJobs.ts')
  assert.match(route, /partial: loaded\.results\.length >= preflightMaxRows,/)
  assert.match(route, /partialCode: loaded\.results\.length >= preflightMaxRows \? 'import_preflight_partial' : null,/,
    'a bare `partial: true` leaves the UI to explain it with a number that may not be this deployment\'s')
  assert.match(route, /maxCheckedRows: preflightMaxRows,/)
  assert.match(route, /planTier: resolvePlanTier\(c\.env\),/)
  // And the cap itself has to differ, or none of the above means anything.
  __resetPlanTierCacheForTests()
  const freeCap = getPlanLimits({ PLAN_TIER: 'free' }).preflightMaxRows
  __resetPlanTierCacheForTests()
  const paidCap = getPlanLimits({ PLAN_TIER: 'paid' }).preflightMaxRows
  assert.ok(freeCap < paidCap, 'free must actually check fewer rows, or `partial` never differs by tier')
})

// --------------------------------------------------------------------------
// Catalog integrity: bounded window, executed for real against both tiers.
// --------------------------------------------------------------------------
function loadRuntimeRoute(products) {
  const captured = []
  const db = {
    prepare(sql) {
      captured.push(sql)
      return {
        all: async () => {
          if (!/FROM products/.test(sql)) return []
          const limitMatch = sql.match(/LIMIT (\d+)/)
          const limit = limitMatch ? Number(limitMatch[1]) : products.length
          return products.slice(0, limit)
        },
        get: async () => (/FROM settings/.test(sql) ? { value: '[]' } : null),
        run: async () => ({}),
      }
    },
  }
  const route = load('routes/runtime.ts', {
    '../lib/db': { getDb: () => db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 1, permissions: JSON.stringify({ settings: true }) }); return next() } },
    '../lib/planTier': planTier,
    // Real: the permission gate and the suspicious-text rule are both pure
    // and are what decide whether this route runs at all.
    '../lib/permissions': load('lib/permissions.ts'),
    '../lib/catalogText': load('lib/catalogText.ts'),
    '../lib/buildStamp': { getBuildStamp: () => ({ revision: 'test', sourceHash: 'test', builtAt: '2026-09-14T00:00:00Z' }) },
    '../index': {},
  })
  const app = new Hono()
  app.route('/api/runtime', route.default || route)
  return { app, captured }
}

function makeProducts(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: `Product ${i + 1}`, brand: null, category: null, unit: null, description: null, supplier: null,
  }))
}

check('catalog integrity bounds its select and reports that it was bounded', async () => {
  __resetPlanTierCacheForTests()
  const freeCap = getPlanLimits({ PLAN_TIER: 'free' }).catalogIntegrityMaxProducts
  const { app, captured } = loadRuntimeRoute(makeProducts(freeCap + 50))
  __resetPlanTierCacheForTests()
  const res = await app.request('/api/runtime/catalog-integrity', {}, { PLAN_TIER: 'free' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.partial, true, 'a truncated scan that reports a clean catalog is the failure this replaces')
  assert.equal(body.partialCode, 'catalog_integrity_partial')
  assert.equal(body.checkedProducts, freeCap)
  assert.equal(body.maxCheckedProducts, freeCap)
  const productSelect = captured.find((sql) => /FROM products/.test(sql))
  assert.match(productSelect, new RegExp(`LIMIT ${freeCap + 1}`),
    'it must read one row PAST the cap -- that extra row is the only way to know there is more')
  assert.match(productSelect, /ORDER BY id/, 'an unordered LIMIT makes the window non-deterministic')
})

check('POSITIVE CONTROL: the same catalog is not partial on paid', async () => {
  __resetPlanTierCacheForTests()
  const freeCap = getPlanLimits({ PLAN_TIER: 'free' }).catalogIntegrityMaxProducts
  const { app } = loadRuntimeRoute(makeProducts(freeCap + 50))
  __resetPlanTierCacheForTests()
  const res = await app.request('/api/runtime/catalog-integrity', {}, { PLAN_TIER: 'paid' })
  const body = await res.json()
  assert.equal(body.partial, false, 'if this were also partial, the check above would be proving nothing')
  assert.equal(body.partialCode, null)
  assert.equal(body.checkedProducts, freeCap + 50)
})

// --------------------------------------------------------------------------
// Tier readout.
// --------------------------------------------------------------------------
check('/runtime/version reports the deploy-time tier', async () => {
  const { app } = loadRuntimeRoute([])
  for (const [planTierVar, expected] of [['free', 'free'], ['paid', 'paid'], [undefined, 'paid'], ['FREE', 'free'], ['nonsense', 'paid']]) {
    __resetPlanTierCacheForTests()
    const res = await app.request('/api/runtime/version', {}, planTierVar === undefined ? {} : { PLAN_TIER: planTierVar })
    const body = await res.json()
    assert.equal(body.tier, expected, `PLAN_TIER=${planTierVar} should report ${expected}`)
  }
  // Never inferred: an env with every binding present but no PLAN_TIER is
  // still paid, and one with NO bindings and PLAN_TIER=paid is still paid.
  __resetPlanTierCacheForTests()
  const noBindings = await (await app.request('/api/runtime/version', {}, { PLAN_TIER: 'paid' })).json()
  assert.equal(noBindings.tier, 'paid')
})

check('the auth bootstrap carries the plan', async () => {
  const source = readSource('routes/auth.ts')
  assert.match(source, /plan: resolvePlanTier\(c\.env\),/,
    'the bootstrap is the one payload every client already reads on login')
  const systemBlock = source.slice(source.indexOf('    system: {'))
  assert.ok(systemBlock.slice(0, 600).includes('plan: resolvePlanTier(c.env)'),
    'it belongs inside system.runtime, beside database/objectStorage/cache')
})

check('the integration doctor reports the tier and stops lying about the queue', async () => {
  const source = readSource('routes/compat.ts')
  assert.doesNotMatch(source, /const queue = \{ ok: true, status: 'configured'/,
    'the hard-coded literal reported a healthy queue on a deployment with no queue binding')
  assert.match(source, /const importQueueBound = !!c\.env\.IMPORT_QUEUE/)
  assert.match(source, /const mediaQueueBound = !!c\.env\.MEDIA_QUEUE/)
  assert.match(source, /tier: resolvePlanTier\(c\.env\)/)
  assert.match(source, /quotas: await readAllQuotas\(c\.env\)/,
    'readAllQuotas was exported and called from nowhere -- dead code that made the ceilings unobservable')
})

// --------------------------------------------------------------------------
// Scheduled backup and the products-reset image sweep.
// --------------------------------------------------------------------------
check('the 6-hourly cron refuses to start a backup it cannot finish on free', async () => {
  const source = readSource('lib/backup.ts')
  assert.match(source, /if \(!getPlanLimits\(env\)\.scheduledBackupEnabled\) \{/)
  assert.match(source, /code: 'scheduled_backup_unavailable_free'/)
  // Retention is the cheap half and is what keeps R2 under the storage
  // ceiling -- it must still run on BOTH tiers, so the refusal has to come
  // after it, not instead of it.
  const fn = source.slice(source.indexOf('export async function maybeRunScheduledBackup'))
  const retentionAt = fn.indexOf('pruneCloudflareBackups(env, CLOUDFLARE_BACKUP_KEEP)')
  const refusalAt = fn.indexOf('scheduledBackupEnabled')
  assert.ok(retentionAt > -1 && refusalAt > retentionAt,
    'refusing before the retention pass would let old backups pile up in R2 forever on free')
  __resetPlanTierCacheForTests()
  assert.equal(getPlanLimits({ PLAN_TIER: 'free' }).scheduledBackupEnabled, false)
  __resetPlanTierCacheForTests()
  assert.equal(getPlanLimits({ PLAN_TIER: 'paid' }).scheduledBackupEnabled, true)
})

check('the products reset refuses the image option on free instead of half-deleting', async () => {
  const source = readSource('routes/system.ts')
  assert.match(source, /if \(includeImages && resolvePlanTier\(c\.env\) === 'free'\) \{/)
  assert.match(source, /code: 'reset_images_unavailable_free'/)
  // The refusal has to land BEFORE anything is deleted, or it is a report,
  // not a gate. `db` is only resolved after it.
  const idx = source.indexOf("code: 'reset_images_unavailable_free'")
  const dbIdx = source.indexOf('const db = getDb(c.env)')
  assert.ok(idx > -1 && dbIdx > idx, 'the gate must precede the reset path it guards')
})

check('every refusal code has a lang pack key of the same name', async () => {
  // The Worker has no translation layer -- a queue invocation has no request
  // locale at all -- so refusals ship English text plus a stable code, and
  // the frontend resolves t(code, englishFallback). Naming the pack key after
  // the code is what removes the mapping table that would otherwise have to
  // be kept in sync by hand.
  const langDir = path.join(cloudflareRoot, '..', 'frontend', 'src', 'lang')
  const en = JSON.parse(fs.readFileSync(path.join(langDir, 'en.json'), 'utf8'))
  const km = JSON.parse(fs.readFileSync(path.join(langDir, 'km.json'), 'utf8'))
  const CODES = [
    'stock_import_over_tier_cap',
    'import_preflight_partial',
    'catalog_integrity_partial',
    'scheduled_backup_unavailable_free',
    'reset_images_unavailable_free',
  ]
  for (const code of CODES) {
    assert.ok(typeof en[code] === 'string' && en[code].length > 0, `en.json is missing ${code}`)
    assert.ok(typeof km[code] === 'string' && km[code].length > 0, `km.json is missing ${code}`)
    assert.notEqual(km[code], en[code], `${code} is untranslated in km.json`)
  }
  for (const key of ['plan_tier_label', 'plan_tier_free', 'plan_tier_paid', 'plan_tier_hint_free', 'plan_tier_hint_paid']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.json is missing ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km.json is missing ${key}`)
  }
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
