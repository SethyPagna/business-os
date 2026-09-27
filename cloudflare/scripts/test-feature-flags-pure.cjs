// Feature flags (C3v2 A0): lib/featureFlags.ts reading KV `rm:flags`.
//
// Pins: parsing (valid / invalid JSON / wrong shapes / unknown states all fall
// to 'off'), the 30 s per-isolate memo (one KV read, then another after
// expiry), a missing binding and a throwing KV are 'off' and memoized,
// concurrent first reads share one KV read, the module never writes KV, and
// the request's first answer wins and is recorded on its metrics.
//
// FEATURE_FLAGS_SOURCE points the loader at another copy (mutation runs).
// Run: node scripts/test-feature-flags-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const SRC = path.join(__dirname, '../src')
function load(rel, overrides = {}, sourcePath) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath || path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const metrics = load('lib/requestMetrics.ts', { './analytics': load('lib/analytics.ts') })
const flags = load('lib/featureFlags.ts', { './requestMetrics': metrics }, process.env.FEATURE_FLAGS_SOURCE)

function fakeKv(value) {
  const kv = {
    value, reads: 0, writes: 0, throwOnGet: false,
    async get(key) {
      kv.reads++
      assert.equal(key, 'rm:flags')
      if (kv.throwOnGet) throw new Error('KV unavailable')
      return kv.value
    },
    async put() { kv.writes++ }, async delete() { kv.writes++ }, async list() { kv.writes++ },
  }
  return kv
}

const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('parse: valid states kept, everything else dropped', () => {
  assert.deepEqual(flags.parseFeatureFlags('{"catalog_one_scan":"shadow","filters_cache":"on","x":"off"}'),
    { catalog_one_scan: 'shadow', filters_cache: 'on', x: 'off' })
  assert.deepEqual(flags.parseFeatureFlags('{"a":"ON","b":true,"c":1,"d":null,"e":"maybe"}'), {})
  assert.deepEqual(flags.parseFeatureFlags('not json'), {})
  assert.deepEqual(flags.parseFeatureFlags('["on"]'), {})
  assert.deepEqual(flags.parseFeatureFlags('"on"'), {})
  assert.deepEqual(flags.parseFeatureFlags('null'), {})
  assert.deepEqual(flags.parseFeatureFlags(''), {})
  assert.deepEqual(flags.parseFeatureFlags(null), {})
  assert.deepEqual(flags.parseFeatureFlags('{"bad name!":"on"}'), {})
})

check('default off: missing key, missing binding, invalid JSON, unknown feature', async () => {
  flags.resetFeatureFlagMemo()
  assert.equal(await flags.flag({ env: { CACHE: fakeKv(null) } }, 'x', 1_000), 'off')
  flags.resetFeatureFlagMemo()
  assert.equal(await flags.flag({ env: {} }, 'x', 1_000), 'off')
  flags.resetFeatureFlagMemo()
  assert.equal(await flags.flag({ env: { CACHE: fakeKv('{oops') } }, 'x', 1_000), 'off')
  flags.resetFeatureFlagMemo()
  assert.equal(await flags.flag({ env: { CACHE: fakeKv('{"y":"on"}') } }, 'x', 1_000), 'off')
  assert.equal(await flags.flag({ env: { CACHE: fakeKv('{"y":"on"}') } }, 'y', 1_000), 'on')
})

check('memo: one KV read per 30 s per isolate, re-read after expiry', async () => {
  flags.resetFeatureFlagMemo()
  const kv = fakeKv('{"a":"shadow"}')
  const c = { env: { CACHE: kv } }
  assert.equal(await flags.flag(c, 'a', 100_000), 'shadow')
  kv.value = '{"a":"on"}'
  assert.equal(await flags.flag(c, 'a', 100_000 + 29_999), 'shadow', 'still memoized just before 30 s')
  assert.equal(kv.reads, 1)
  assert.equal(await flags.flag(c, 'a', 100_000 + 30_000), 'on', 're-read at 30 s')
  assert.equal(kv.reads, 2)
  assert.equal(kv.writes, 0, 'flags never write KV')
})

check('a throwing KV is off and memoized (no read storm)', async () => {
  flags.resetFeatureFlagMemo()
  const kv = fakeKv('{"a":"on"}')
  kv.throwOnGet = true
  assert.equal(await flags.flag({ env: { CACHE: kv } }, 'a', 5_000), 'off')
  assert.equal(await flags.flag({ env: { CACHE: kv } }, 'a', 6_000), 'off')
  assert.equal(kv.reads, 1)
})

check('concurrent first reads share one KV read', async () => {
  flags.resetFeatureFlagMemo()
  const kv = fakeKv('{"a":"on"}')
  const states = await Promise.all(Array.from({ length: 5 }, () => flags.flag({ env: { CACHE: kv } }, 'a', 9_000)))
  assert.deepEqual(states, ['on', 'on', 'on', 'on', 'on'])
  assert.equal(kv.reads, 1)
})

check('first answer wins within a request and is recorded on its metrics', async () => {
  flags.resetFeatureFlagMemo()
  const kv = fakeKv('{"a":"shadow","b":"on"}')
  const points = []
  const app = new Hono()
  app.use('/api/*', metrics.createRequestMetricsMiddleware({ random: () => 0 }))
  let seen
  app.get('/api/f', async (c) => {
    const first = await flags.flag(c, 'a', 50_000)
    kv.value = '{"a":"on","b":"on"}'
    const second = await flags.flag(c, 'a', 50_000 + 60_000) // memo expired mid-request
    const b = await flags.flag(c, 'b', 50_000 + 60_000)
    seen = [first, second, b]
    return c.json({})
  })
  await app.request('/api/f', {}, { CACHE: kv, Business_OS_Analytics: { writeDataPoint: (p) => points.push(p) } },
    { waitUntil() {}, passThroughOnException() {} })
  assert.deepEqual(seen, ['shadow', 'shadow', 'on'])
  assert.equal(points.length, 1)
  assert.equal(points[0].blobs[5], 'a=shadow;b=on')
})

check('outside a request, flag() still answers and records nothing', async () => {
  flags.resetFeatureFlagMemo()
  assert.equal(await flags.flag({ env: { CACHE: fakeKv('{"a":"on"}') } }, 'a', 1), 'on')
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`) } catch (error) { failed++; console.error(`not ok - ${name}\n  ${error && error.stack || error}`) }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exit(1)
})()
