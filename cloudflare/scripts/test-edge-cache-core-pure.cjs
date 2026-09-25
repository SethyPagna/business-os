// K1 edge cache core: lib/cache.ts cachedJson() + lib/serverTiming.ts.
//
// Every check below is built to fail against the plausible wrong
// implementation, not merely to pass against this one:
//
// - the 304 check counts cache.match calls AND replaces the global `caches`
//   with a tripwire, so an implementation that matched first and compared
//   the ETag afterwards fails even though it would also "return 304";
// - the actor check sends actor A's ETag as actor B, so an ETag without the
//   actor input fails on a real cross-user 304, not only on string inequality;
// - the stampede check holds the producer open until all five callers have
//   missed, so a guard that only dedupes AFTER the first put fails;
// - the bypass check runs the same header against a public route and a staff
//   route, so "always honour no-cache" and "never honour it" both fail;
// - the bucket check straddles 19 999 / 20 000 ms, not 0 / 60 000.
//
// Run: node scripts/test-edge-cache-core-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const libDir = path.join(__dirname, '..', 'src', 'lib')

// --- loader: transpile lib/*.ts on demand, stubbing the D1/quota modules ---
const stubs = {
  './db': { getDb: () => { throw new Error('D1 must not be touched by these tests') } },
  './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) },
}
const loaded = new Map()
function loadLib(name) {
  if (loaded.has(name)) return loaded.get(name).exports
  const sourcePath = path.join(libDir, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  })
  const moduleObj = { exports: {} }
  loaded.set(name, moduleObj)
  const localRequire = (request) => {
    if (request in stubs) return stubs[request]
    if (request.startsWith('./')) return loadLib(request.slice(2))
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, localRequire, moduleObj, sourcePath, libDir,
  )
  return moduleObj.exports
}

const cacheLib = loadLib('cache')
const timingLib = loadLib('serverTiming')

// --- fakes ---
function fakeCache() {
  const store = new Map()
  const stats = { match: 0, put: 0 }
  return {
    stats,
    store,
    async match(request) {
      stats.match++
      await Promise.resolve()
      const hit = store.get(request.url)
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined
    },
    async put(request, response) {
      stats.put++
      store.set(request.url, { body: await response.text(), headers: Object.fromEntries(response.headers.entries()) })
    },
  }
}
function fakeCtx() {
  const pending = []
  return { pending, waitUntil(promise) { pending.push(promise) }, async drain() { while (pending.length) await pending.shift() } }
}
function counter(valueFn) {
  const producer = async () => { producer.calls++; return valueFn(producer.calls) }
  producer.calls = 0
  return producer
}
function req(url, headers = {}) {
  return new Request(url, { headers })
}
const TRIPWIRE = new Proxy({}, { get() { throw new Error('caches.default was touched') } })

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log('PASS', name)
  } catch (error) {
    failures++
    console.log('FAIL', name, '-', error && error.message)
  }
}

const URL_A = 'https://admin.example/api/products/search?q=lip&page=1'
const staff = (overrides = {}) => ({
  version: 'products=k2:7', ttlSeconds: 20, actorId: 11, permissionFingerprint: 'staff|admin=0|{}',
  buildHash: 'build-1', now: () => 1_000_000, allowClientBypass: true, ...overrides,
})

;(async () => {
  await check('a matching If-None-Match answers 304 with no producer call and no cache.match', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    const producer = counter(() => ({ items: [1, 2, 3] }))
    const first = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff(), cache, producer })
    await ctx.drain()
    assert.equal(first.status, 'MISS')
    assert.match(first.etag, /^W\/"[0-9a-f]{40}"$/)
    const matchesBefore = cache.stats.match
    const saved = globalThis.caches
    globalThis.caches = TRIPWIRE
    try {
      // No `cache` seam here: any Cache API access at all hits the tripwire.
      const second = await cacheLib.cachedJson(req(URL_A, { 'If-None-Match': first.etag }), ctx, { ...staff(), producer })
      assert.equal(second.status, 'NOT_MODIFIED')
      assert.equal(second.payload, null)
      assert.equal(second.etag, first.etag)
    } finally {
      globalThis.caches = saved
    }
    assert.equal(producer.calls, 1, 'the producer ran only for the first request')
    assert.equal(cache.stats.match, matchesBefore, 'no cache.match on the 304 path')
  })

  await check('a different actor (or permission set) gets a different ETag and never a cross-user 304', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    const producer = counter(() => ({ ok: true }))
    const a = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ actorId: 11 }), cache, producer })
    const b = await cacheLib.cachedJson(req(URL_A, { 'If-None-Match': a.etag }), ctx, { ...staff({ actorId: 12 }), cache, producer })
    assert.notEqual(b.etag, a.etag)
    assert.notEqual(b.status, 'NOT_MODIFIED', "actor A's ETag must not validate for actor B")
    const demoted = await cacheLib.cachedJson(req(URL_A, { 'If-None-Match': a.etag }), ctx, {
      ...staff({ actorId: 11, permissionFingerprint: 'staff|admin=0|{"products":"view"}' }), cache, producer,
    })
    assert.notEqual(demoted.status, 'NOT_MODIFIED', 'a permission change invalidates the ETag')
    const pub1 = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ actorId: null, permissionFingerprint: null }), cache, producer })
    const pub2 = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ actorId: undefined, permissionFingerprint: undefined }), cache, producer })
    assert.equal(pub1.etag, pub2.etag, 'public responses share one ETag')
  })

  await check('a build hash change misses the cache and changes the ETag', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    const producer = counter((n) => ({ n }))
    const one = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ buildHash: 'build-1' }), cache, producer })
    await ctx.drain()
    const same = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ buildHash: 'build-1' }), cache, producer })
    assert.equal(same.status, 'HIT', 'control: same build hits')
    const next = await cacheLib.cachedJson(req(URL_A, { 'If-None-Match': one.etag }), ctx, { ...staff({ buildHash: 'build-2' }), cache, producer })
    assert.equal(next.status, 'MISS')
    assert.notEqual(next.etag, one.etag)
    assert.equal(producer.calls, 2)
    assert.ok(Array.from(cache.store.keys()).every((key) => /[?&]_b=build-[12]/.test(key) && /[?&]_v=/.test(key)), 'keys carry _v and _b')
  })

  await check('the stampede guard runs the producer once for 5 concurrent misses', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let calls = 0
    const producer = async () => { calls++; await gate; return { rows: [{ id: 1 }] } }
    const runs = Array.from({ length: 5 }, () => cacheLib.cachedJson(req(URL_A), ctx, { ...staff(), cache, producer }))
    // Let every caller reach its miss while the producer is still open.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(cacheLib.inflightCacheProducers(), 1, 'one in-flight producer for the key')
    release()
    const results = await Promise.all(runs)
    assert.equal(calls, 1, `producer ran ${calls} times`)
    assert.ok(results.every((r) => r.status === 'MISS' && r.payload.rows[0].id === 1))
    results[1].payload.rows[0].id = 999
    assert.equal(results[2].payload.rows[0].id, 1, 'joiners do not share a mutable payload')
    assert.equal(cacheLib.inflightCacheProducers(), 0, 'the guard releases the key')
    await ctx.drain()
    assert.equal(cache.stats.put, 1, 'one cache write')
  })

  await check('a producer failure rejects every joiner and releases the key', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    let calls = 0
    const producer = async () => { calls++; await new Promise((r) => setTimeout(r, 2)); throw new Error('boom') }
    const runs = Array.from({ length: 3 }, () => cacheLib.cachedJson(req(URL_A), ctx, { ...staff(), cache, producer }).then(() => 'ok', (e) => e.message))
    assert.deepEqual(await Promise.all(runs), ['boom', 'boom', 'boom'])
    assert.equal(calls, 1)
    assert.equal(cacheLib.inflightCacheProducers(), 0)
  })

  await check('Cache-Control: no-cache bypasses for a staff route but not for a public one', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    let value = 'old'
    const producer = counter(() => ({ value }))
    const opts = (allowClientBypass) => ({ ...staff({ allowClientBypass }), cache, producer })
    const seeded = await cacheLib.cachedJson(req(URL_A), ctx, opts(true))
    await ctx.drain()
    value = 'new'
    const publicTry = await cacheLib.cachedJson(req(URL_A, { 'Cache-Control': 'no-cache' }), ctx, { ...staff(), allowClientBypass: undefined, cache, producer })
    assert.equal(publicTry.status, 'HIT', 'the default (public) route ignores a client bypass')
    assert.equal(publicTry.payload.value, 'old')
    assert.equal(producer.calls, 1)
    const staffTry = await cacheLib.cachedJson(req(URL_A, { 'Cache-Control': 'no-cache', 'If-None-Match': seeded.etag }), ctx, opts(true))
    assert.equal(staffTry.status, 'BYPASS', 'staff bypass skips both the 304 and the match')
    assert.equal(staffTry.payload.value, 'new')
    assert.equal(producer.calls, 2)
    await ctx.drain()
    const after = await cacheLib.cachedJson(req(URL_A), ctx, opts(true))
    assert.equal(after.status, 'HIT')
    assert.equal(after.payload.value, 'new', 'the bypass wrote the fresh result back')
  })

  await check('the stock bucket rolls at 20 s and only for stock-bearing routes', async () => {
    const etagAt = async (now, stockBearing) => (await cacheLib.cachedJson(req(URL_A), fakeCtx(), {
      ...staff({ now: () => now, stockBearing }), cache: fakeCache(), producer: async () => 1,
    })).etag
    assert.equal(await etagAt(0, true), await etagAt(19_999, true), 'same bucket inside 20 s')
    assert.notEqual(await etagAt(19_999, true), await etagAt(20_000, true), 'rolls at exactly 20 000 ms')
    assert.equal(await etagAt(0, false), await etagAt(20_000, false), 'non-stock routes do not roll')
    assert.equal(cacheLib.stockBucket(39_999), 1)
    assert.equal(cacheLib.stockBucket(40_000), 2)
  })

  await check('SWR serves stale past swrAfterMs, refreshes once, and never past the hard max', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    let now = 100_000
    const producer = counter((n) => ({ n }))
    const opts = () => ({ ...staff({ now: () => now, swrAfterMs: 10_000, hardMaxAgeMs: 60_000 }), cache, producer })
    await cacheLib.cachedJson(req(URL_A), ctx, opts())
    await ctx.drain()
    now += 5_000
    assert.equal((await cacheLib.cachedJson(req(URL_A), ctx, opts())).status, 'HIT')
    now += 10_000
    const stale = await cacheLib.cachedJson(req(URL_A), ctx, opts())
    assert.equal(stale.status, 'STALE')
    assert.equal(stale.payload.n, 1, 'served the stored copy')
    await ctx.drain()
    assert.equal(producer.calls, 2, 'refreshed in waitUntil')
    const refreshed = await cacheLib.cachedJson(req(URL_A), ctx, opts())
    assert.equal(refreshed.payload.n, 2)
    now += 61_000
    const expired = await cacheLib.cachedJson(req(URL_A), ctx, opts())
    assert.equal(expired.status, 'MISS', 'older than hardMaxAgeMs is never served')
  })

  await check('an entry without a stored-at stamp is a plain HIT (Cache API max-age bounds it), never SWR', async () => {
    const cache = fakeCache()
    const ctx = fakeCtx()
    const producer = counter(() => ({ fresh: true }))
    const probe = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ swrAfterMs: 0 }), cache, producer })
    await ctx.drain()
    const key = Array.from(cache.store.keys())[0]
    cache.store.set(key, { body: JSON.stringify({ fresh: false }), headers: { 'content-type': 'application/json' } })
    const hit = await cacheLib.cachedJson(req(URL_A), ctx, { ...staff({ swrAfterMs: 0 }), cache, producer })
    assert.equal(probe.status, 'MISS')
    assert.equal(hit.status, 'HIT')
    assert.equal(hit.payload.fresh, false)
    await ctx.drain()
    assert.equal(producer.calls, 1, 'no refresh for an entry of unknown age')
  })

  await check('If-None-Match parsing: lists and W/ match, * does not', () => {
    const tag = 'W/"abc"'
    assert.equal(cacheLib.ifNoneMatchSatisfied('"x", W/"abc"', tag), true)
    assert.equal(cacheLib.ifNoneMatchSatisfied('"abc"', tag), true)
    assert.equal(cacheLib.ifNoneMatchSatisfied('*', tag), false)
    assert.equal(cacheLib.ifNoneMatchSatisfied('', tag), false)
  })

  await check('legacy cachedJsonResponse keeps its signature, adds _b, never answers 304', async () => {
    const cache = fakeCache()
    const saved = globalThis.caches
    globalThis.caches = { default: cache }
    try {
      const ctx = fakeCtx()
      let calls = 0
      const producer = async () => { calls++; return { list: [calls] } }
      const first = await cacheLib.cachedJsonResponse(req(URL_A, { 'If-None-Match': '*' }), ctx, 'v9', 30, producer)
      await ctx.drain()
      assert.deepEqual(first, { list: [1] })
      const key = Array.from(cache.store.keys())[0]
      assert.match(key, /_v=v9/)
      assert.match(key, /_b=dev/, 'an unstamped build keys on dev')
      assert.equal(cache.store.get(key).headers['cache-control'], 'public, max-age=30')
      const second = await cacheLib.cachedJsonResponse(req(URL_A, { 'Cache-Control': 'no-cache' }), ctx, 'v9', 30, producer)
      assert.deepEqual(second, { list: [1] }, 'hit, and no client bypass on the legacy path')
      assert.equal(calls, 1)
    } finally {
      globalThis.caches = saved
    }
  })

  await check('canonical query ignores order and the internal _v/_b/_p params', () => {
    const a = cacheLib.canonicalQueryOf(new URL('https://x/api?b=2&a=1&_v=9'))
    const b = cacheLib.canonicalQueryOf(new URL('https://x/api?a=1&b=2&_b=zz'))
    assert.equal(a, 'a=1&b=2')
    assert.equal(a, b)
  })

  await check('permissionFingerprint is order-independent and reflects a grant change', () => {
    const u1 = { role_code: 'staff', role_permissions: JSON.stringify({ a: true, b: 'view' }), permissions: null, username: 'x' }
    const u2 = { role_code: 'staff', role_permissions: JSON.stringify({ b: 'view', a: true }), permissions: null, username: 'x' }
    const u3 = { ...u1, permissions: JSON.stringify({ b: 'full' }) }
    assert.equal(cacheLib.permissionFingerprint(u1), cacheLib.permissionFingerprint(u2))
    assert.notEqual(cacheLib.permissionFingerprint(u1), cacheLib.permissionFingerprint(u3))
  })

  await check('Server-Timing formatting', () => {
    const c = new timingLib.ServerTimingCollector(() => 0)
    assert.equal(timingLib.formatServerTiming(c.snapshot(null)), '', 'nothing observed, nothing claimed')
    c.setCache('HIT', 1234)
    c.addKv(1.26)
    c.addD1({ durMs: 3, statements: 2, rows: 10 })
    c.addD1({ durMs: 4.5, rows: 31 })
    c.colo = 'SIN'
    assert.equal(
      timingLib.formatServerTiming(c.snapshot(14)),
      'cache;desc=HIT, kv;dur=1.3, d1;dur=7.5;desc="stmts=3 rows=41", app;dur=14, colo;desc=SIN',
    )
    const bare = new timingLib.ServerTimingCollector(() => 0)
    assert.equal(timingLib.formatServerTiming(bare.snapshot(2)), 'app;dur=2', 'no d1/kv entry when none recorded')
  })

  await check('cachedJson reports its status into the request collector', async () => {
    const request = req(URL_A)
    const collector = timingLib.attachServerTiming(request)
    await cacheLib.cachedJson(request, fakeCtx(), { ...staff(), cache: fakeCache(), producer: async () => ({ a: 1 }) })
    assert.equal(collector.cacheStatus, 'MISS')
    assert.equal(collector.bytes, JSON.stringify({ a: 1 }).length)
    assert.equal(timingLib.serverTimingOf(req(URL_A)), null, 'a different request has no collector')
  })

  await check('the middleware sets Server-Timing and samples 10% of cached requests with no identity', async () => {
    const points = []
    const env = { Business_OS_Analytics: { writeDataPoint: (p) => points.push(p) } }
    const run = async (randomValue, cached) => {
      let t = 0
      const mw = timingLib.createServerTimingMiddleware({ clock: () => (t += 7), random: () => randomValue, classify: () => 'F' })
      const raw = new Request('https://admin.example/api/customers/membership/000123')
      Object.defineProperty(raw, 'cf', { value: { colo: 'SIN' } })
      const c = { req: { raw, path: '/api/customers/membership/000123' }, env, res: new Response('{}') }
      await mw(c, async () => {
        if (cached) timingLib.serverTimingOf(raw).setCache('HIT', 2)
        c.res = new Response('{}')
      })
      return c.res.headers.get('server-timing')
    }
    assert.equal(await run(0.05, true), 'cache;desc=HIT, app;dur=7, colo;desc=SIN')
    assert.equal(points.length, 1)
    assert.deepEqual(points[0].indexes, ['cache'])
    assert.deepEqual(points[0].blobs, ['F', 'HIT', 'SIN'])
    assert.deepEqual(points[0].doubles, [7, 2])
    assert.ok(!JSON.stringify(points).includes('000123'), 'no path/membership number in analytics')
    await run(0.5, true)
    assert.equal(points.length, 1, 'outside the 10% sample')
    await run(0.01, false)
    assert.equal(points.length, 1, 'uncached routes are never sampled')
  })

  await check('end to end in Hono: 200 then 304, projection kept, headers from both middlewares', async () => {
    const { Hono } = require('hono')
    const http = loadLib('httpCache')
    const cache = fakeCache()
    const saved = globalThis.caches
    globalThis.caches = { default: cache }
    try {
      let produced = 0
      const app = new Hono()
      app.use('/api/*', timingLib.createServerTimingMiddleware({ classify: http.routeClassLabel, random: () => 1 }))
      app.use('/api/*', http.createHttpCacheMiddleware({ buildHash: () => 'bh' }))
      // Stand-in for acquisitionCostResponses: a c.json wrapper that projects.
      app.use('/api/products/*', async (c, next) => {
        const json = c.json
        c.json = (...args) => { args[0] = { ...args[0], cost: undefined, projected: true }; return json.apply(c, args) }
        await next()
      })
      app.get('/api/products/search', async (c) => {
        const result = await cacheLib.cachedJson(c.req.raw, c.executionCtx, {
          version: 'products=k2:1', ttlSeconds: 20, actorId: 5, permissionFingerprint: 'p', buildHash: 'bh',
          producer: async () => { produced++; return { items: [1], cost: 9 } },
        })
        return cacheLib.sendCachedJson(c, result)
      })
      const ctx = fakeCtx()
      const first = await app.fetch(new Request('https://a/api/products/search?q=x'), {}, ctx)
      await ctx.drain()
      assert.equal(first.status, 200)
      const body = await first.json()
      assert.equal(body.projected, true, 'the 200 went through c.json and its projection')
      assert.equal(body.cost, undefined)
      const etag = first.headers.get('etag')
      assert.match(etag, /^W\//)
      assert.equal(first.headers.get('x-bos-v'), 'products=k2:1')
      assert.equal(first.headers.get('x-bos-build'), 'bh')
      assert.equal(first.headers.get('cache-control'), 'private, no-cache', 'class F filled by the policy middleware')
      assert.match(first.headers.get('server-timing'), /^cache;desc=MISS, app;dur=/)
      const second = await app.fetch(new Request('https://a/api/products/search?q=x', { headers: { 'If-None-Match': etag } }), {}, ctx)
      assert.equal(second.status, 304)
      assert.equal(await second.text(), '')
      assert.equal(second.headers.get('etag'), etag)
      assert.match(second.headers.get('server-timing'), /^cache;desc=NOT_MODIFIED/)
      assert.equal(produced, 1)
    } finally {
      globalThis.caches = saved
    }
  })

  await check('setHeaderSafely handles immutable headers', () => {
    const immutable = Response.redirect('https://x/', 302)
    const c = { res: immutable }
    timingLib.setHeaderSafely(c, 'X-Test', '1')
    assert.equal(c.res.headers.get('x-test'), '1')
    assert.equal(c.res.status, 302)
  })

  if (failures) {
    console.log(`\n${failures} check(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\nall edge cache core checks passed')
  }
})()
