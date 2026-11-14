'use strict'
// CACHE-LIFECYCLE R3 / T-CL5 (lane 6.0.1048): a cache version or the data epoch that cannot be read is "no safe key". The producer
// runs, nothing is matched, nothing is stored, and no reader ever shares a zero token. A bump that cannot read D1 never starts a
// KV counter at 1. Runs the REAL lib/cache.ts and lib/cacheKey.ts with a fake KV, a fake D1 and a fake Cache API.
//
// Run: node scripts/test-cache-version-fail-closed-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, requireFor) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}

const state = { d1: 'healthy', rows: new Map(), epoch: 'a'.repeat(32), kvGetFails: false }
const db = {
  prepare(sql) {
    return {
      async get(params) {
        if (state.d1 === 'throws') throw new Error('D1 unavailable')
        const row = state.rows.get(params.namespace)
        return row == null ? undefined : { version: row }
      },
      async all(params) {
        if (state.d1 === 'throws') throw new Error('D1 unavailable')
        // The version read binds one positional placeholder per distinct namespace (no json_each: D1 meters its rows).
        return params.filter((namespace) => state.rows.has(namespace)).map((namespace) => ({ namespace, version: state.rows.get(namespace) }))
      },
    }
  },
  async batch() { if (state.d1 === 'throws') throw new Error('D1 unavailable'); return [] },
}
const cacheKey = load('lib/cacheKey.ts', (id) => (id === './readSwitches' ? { readDataEpoch: async () => state.epoch } : require(id)))
const cache = load('lib/cache.ts', (id) => (id === './db' ? { getDb: () => db } : id === './quotaGuard' ? { consumeQuota: async () => ({ zone: 'ok' }) } : id === './cacheKey' ? cacheKey : require(id)))

const kv = new Map()
const puts = []
const env = {
  CF_VERSION_METADATA: { id: 'build-1' },
  CACHE: {
    async get(key) { if (state.kvGetFails) throw new Error('KV unavailable'); return kv.has(key) ? kv.get(key) : null },
    async put(key, value) { puts.push([key, value]); kv.set(key, value) },
    async delete(key) { kv.delete(key) },
  },
}
const store = new Map()
let matches = 0
let stores = 0
globalThis.caches = {
  default: {
    async match(request) { matches += 1; const hit = store.get(request.url); return hit ? new Response(hit, { headers: { 'content-type': 'application/json' } }) : undefined },
    async put(request, response) { stores += 1; store.set(request.url, await response.text()) },
  },
}
const ctx = { waitUntil: (promise) => { void Promise.resolve(promise).catch(() => {}) } }
const identity = () => cacheKey.cacheIdentity({ env, get: () => ({ organization_id: 1 }) })
const request = () => new Request('https://admin.example.test/api/sales?b=2&a=1&_v=ignored')
const reset = () => { kv.clear(); puts.length = 0; store.clear(); matches = 0; stores = 0; state.d1 = 'healthy'; state.rows.clear(); state.epoch = 'a'.repeat(32); state.kvGetFails = false }
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

let passed = 0
async function check(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${error && error.message}`) } }

async function main() {
  await check('positive control: with readable versions the entry is stored once and the second call is a hit', async () => {
    reset()
    state.rows.set('sales', 4)
    let produced = 0
    const version = await cache.getVersionWithFallback(env, 'sales')
    assert.match(version, /^d2:4$/)
    await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return { n: produced } }, identity())
    await settle()
    const second = await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return { n: produced } }, identity())
    assert.equal(produced, 1)
    assert.deepEqual(second, { n: 1 })
    assert.equal(stores, 1)
  })

  await check('KV empty and D1 unreadable: the version is a unique unsafe token, never the shared zero token', async () => {
    reset()
    state.d1 = 'throws'
    const a = await cache.getVersionWithFallback(env, 'sales')
    const b = await cache.getVersionWithFallback(env, 'sales')
    assert.ok(cacheKey.isUnsafeVersion(a) && cacheKey.isUnsafeVersion(b))
    assert.notEqual(a, b, 'two readers never share a token')
    assert.doesNotMatch(a, /^k2:0$/)
    const [x] = await cache.getVersionsWithFallback(env, ['sales'])
    assert.ok(cacheKey.isUnsafeVersion(x))
  })

  await check('an unsafe version runs the producer every time and touches the Cache API not at all', async () => {
    reset()
    state.d1 = 'throws'
    let produced = 0
    for (let i = 0; i < 3; i++) {
      const version = await cache.getVersionWithFallback(env, 'sales')
      await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return { n: produced } }, identity())
    }
    await settle()
    assert.equal(produced, 3)
    assert.equal(matches, 0, 'nothing matched')
    assert.equal(stores, 0, 'nothing stored')
  })

  await check('a version string that merely contains an unsafe token (a joined section key) is unsafe too', async () => {
    reset()
    let produced = 0
    const joined = `products:d2:3|sales:${cacheKey.unsafeVersionToken()}`
    await cache.cachedJsonResponse(request(), ctx, joined, 30, () => { produced += 1; return {} }, identity())
    await cache.cachedJsonResponse(request(), ctx, joined, 30, () => { produced += 1; return {} }, identity())
    assert.equal(produced, 2)
    assert.equal(matches + stores, 0)
  })

  await check('no readable data epoch: no safe key either', async () => {
    reset()
    state.rows.set('sales', 4)
    state.epoch = null
    let produced = 0
    const version = await cache.getVersionWithFallback(env, 'sales')
    await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return {} }, identity())
    await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return {} }, identity())
    await settle()
    assert.equal(produced, 2)
    assert.equal(matches + stores, 0)
  })

  await check('no identity at all (a caller that did not say who it is): no safe key', async () => {
    reset()
    state.rows.set('sales', 4)
    let produced = 0
    const version = await cache.getVersionWithFallback(env, 'sales')
    await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return {} })
    await cache.cachedJsonResponse(request(), ctx, version, 30, () => { produced += 1; return {} })
    assert.equal(produced, 2)
    assert.equal(matches + stores, 0)
  })

  await check('KV failing and D1 not holding the namespace still refuses to invent a version (unchanged)', async () => {
    reset()
    state.kvGetFails = true
    await assert.rejects(() => cache.getVersionWithFallback(env, 'sales'), /unreadable/)
  })

  await check('never-bumped is still the zero token when D1 answered "no row" (a healthy empty answer is not a failure)', async () => {
    reset()
    const version = await cache.getVersionWithFallback(env, 'never_bumped')
    assert.equal(version, 'k2:0')
  })

  await check('a bump with D1 unreadable and no KV counter does not start the counter at 1', async () => {
    reset()
    state.d1 = 'throws'
    const before = Date.now()
    await cache.bumpVersions(env, ['sales'])
    assert.equal(puts.length, 1)
    assert.notEqual(puts[0][1], '1')
    assert.ok(Number(puts[0][1]) >= before, 'it starts at the clock, above any counter a write has produced')
  })

  await check('positive control: a bump with D1 healthy and no row still starts at 1', async () => {
    reset()
    await cache.bumpVersions(env, ['sales'])
    assert.equal(puts.length, 1)
    assert.equal(puts[0][1], '1')
  })

  await check('a bump on an existing KV counter is unchanged: +1', async () => {
    reset()
    kv.set('v2:sales', '41')
    state.d1 = 'throws'
    await cache.bumpVersions(env, ['sales'])
    assert.equal(kv.get('v2:sales'), '42')
  })

  await check('the key builder: parameters are canonical, the build, organisation and epoch each change the key', async () => {
    reset()
    const keyOf = async (url, overrides = {}) => (await cacheKey.cacheKeyRequest(url, 'd2:4', { ...identity(), ...overrides })).url
    const base = await keyOf('https://admin.example.test/api/sales?b=2&a=1')
    assert.equal(base, await keyOf('https://other.example.test/api/sales?a=1&b=2&_v=zzz'), 'the host, the order and the version parameter do not matter')
    assert.notEqual(base, await keyOf('https://admin.example.test/api/sales?a=1&b=3'))
    assert.notEqual(base, await keyOf('https://admin.example.test/api/sales?a=1&b=2', { org: '2' }))
    assert.notEqual(base, await keyOf('https://admin.example.test/api/sales?a=1&b=2', { env: { ...env, CF_VERSION_METADATA: { id: 'build-2' } } }))
    state.epoch = 'b'.repeat(32)
    assert.notEqual(base, await keyOf('https://admin.example.test/api/sales?a=1&b=2'), 'a rotated epoch makes every older entry unreachable')
    assert.match(base, /^https:\/\/[^/]+\/__bos\/c\/v1\/[0-9a-f]{64}$/)
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
