// Actual portal key builder, Hono query parser and shared Cache API wrapper.
const assert = require('node:assert/strict')
const { Hono } = require('hono')
const { load } = require('./test-request-body-guard-pure.cjs')

async function main() {
  const cacheModule = load('lib/cache.ts')
  const { portalCacheRequest } = load('routes/portal.ts')
  const entries = new Map()
  let produced = 0, lastKey
  global.caches = { default: {
    match: async request => { lastKey = request.url; return entries.get(request.url)?.clone() },
    put: async (request, response) => { entries.set(request.url, response.clone()) },
  } }
  const context = { waitUntil: promise => pending.push(promise) }
  const pending = []
  let version = 'portal-query-v1:k2:1:k2:2'
  const app = new Hono()
  app.get('*', async c => c.json(await cacheModule.cachedJsonResponse(
    portalCacheRequest(c.req.raw, c.req.query(), c.req.path), context, version, 30,
    () => ({ produced: ++produced, parsed: c.req.query() }),
  )))
  async function get(url) {
    const response = await app.request(url)
    await Promise.all(pending.splice(0))
    assert.equal(response.status, 200)
    return { value: await response.json(), key: lastKey }
  }
  const root = 'https://shop.test/api/portal'
  const independent = ['/config', '/bootstrap', '/catalog/meta', '/catalog/products']
  const independentKeys = []
  for (const route of independent) {
    const first = await get(root + route)
    const ignored = await get(root + route + '?tracking=123&page=2&q=random&_v=attacker')
    assert.deepEqual(ignored, first, route)
    assert.deepEqual(await get(root + route.replace(/c/, '%63') + '?ignored=encoded'), first, 'encoded literal path uses matched Hono path')
    independentKeys.push(first.key)
  }
  assert.equal(new Set(independentKeys).size, 4, 'path isolation')
  const search = root + '/catalog/products/search'
  const a = await get(search + '?query=cream&page=2&brand=A')
  const b = await get(search + '?brand=A&ignored=anything&page=2&query=cream')
  assert.deepEqual(a, b, 'ignored and reordered parameters hit same cached entry')
  const blank = await get(search)
  const params = {
    page: '2', pageSize: '100', query: 'cream', q: 'lotion', brand: 'Brand A',
    category: 'Skin', branchId: '1,1', branch_id: '2', stockState: 'out', initial: 'C', promo: 'promoted',
  }
  for (const [key, value] of Object.entries(params)) {
    const changed = await get(search + '?' + new URLSearchParams({ [key]: value }))
    assert.notEqual(changed.key, blank.key, `${key} is meaningful`)
    assert.equal(changed.value.parsed[key], value)
    const ignoredDuplicate = await get(search + '?' + new URLSearchParams([[key, value], [key, 'ignored-second'], ['noise', 'x']]))
    assert.deepEqual(ignoredDuplicate, changed, `${key}: Hono first value wins`)
  }
  // No key-only alias merging, branch deduplication, trimming or lowercasing.
  for (const [left, right] of [
    ['branchId=1', 'branchId=1,1'], ['branchId=1', 'branch_id=1'],
    ['query=cream', 'q=cream'], ['query=cream&q=lotion', 'query=&q=lotion'],
    ['page=1', 'page=01'], ['brand=A', 'brand=a'], ['query=x', 'query=%20x%20'],
    ['q=', ''], ['initial=A', 'initial=all'],
  ]) assert.notEqual((await get(search + '?' + left)).key, (await get(search + '?' + right)).key)
  // Use actual Hono query semantics even on encoded names/values and duplicates.
  for (const query of ['%71=hello+world&q=second', 'q=%E0%A4%A', 'q=%26%3D%2B', 'branchId=1%2C1', 'query=&query=second&q=fallback']) {
    const parsedApp = new Hono().get('*', c => c.json(c.req.query()))
    const parsed = await (await parsedApp.request(search + '?' + query)).json()
    const result = await get(search + '?' + query)
    const keyQuery = Object.fromEntries(new URL(result.key).searchParams)
    for (const key of Object.keys(params)) {
      if (Object.hasOwn(parsed, key)) assert.equal(keyQuery[key], parsed[key], query)
    }
  }
  const hostA = await get(search)
  const hostB = await get(search.replace('shop.test', 'other.test'))
  assert.notEqual(hostA.key, hostB.key)
  version = 'portal-query-v1:k2:2:k2:2'
  assert.notEqual((await get(search)).key, hostA.key, 'products version isolation')
  version = 'portal-query-v1:k2:1:k2:3'
  assert.notEqual((await get(search)).key, hostA.key, 'settings version isolation')
  version = 'k2:1:k2:2'
  assert.notEqual((await get(search)).key, hostA.key, 'old generation cannot collide')
  const outside = new Request('https://shop.test/api/products?q=x&noise=1')
  assert.equal(portalCacheRequest(outside, { q: 'x', noise: '1' }, '/api/products'), outside)
  assert.notEqual((await get(outside.url)).key, (await get(outside.url.replace('noise=1', 'noise=2'))).key)

  // Actual five portal handlers hit cache before any SQL producer. A KV version
  // hit must not introduce a D1 gate. Cache matches expose the real generated key.
  let dbCalls = 0, versionReads = 0
  const realCache = load('lib/cache.ts', {
    './db': { getDb: () => { dbCalls++; throw new Error('Unexpected D1 on cache hit') } },
  })
  const portal = load('routes/portal.ts', {
    '../lib/cache': realCache,
    '../lib/db': { getDb: () => { dbCalls++; throw new Error('Unexpected portal producer on cache hit') } },
  }).default
  global.caches.default.match = async request => new Response(JSON.stringify({ key: request.url }))
  const mounted = new Hono().route('/api/portal', portal)
  const env = { CACHE: { get: async key => { versionReads++; return key === 'v2:products' ? '4' : '7' } } }
  for (const route of [...independent, '/catalog/products/search']) {
    const response = await mounted.fetch(new Request(root + route + '?q=cream&noise=x'), env, context)
    assert.equal(response.status, 200, route)
    const { key } = await response.json()
    const query = new URL(key).searchParams
    assert.equal(query.get('_v'), 'portal-query-v1:k2:4:k2:7')
    assert.equal(query.get('noise'), null)
    assert.equal(query.get('q'), route.endsWith('/search') ? 'cream' : null)
  }
  assert.equal(dbCalls, 0)
  assert.equal(versionReads, 10)
  console.log('PASS portal caching: all five actual handlers, eleven consumed parameters, first-value semantics, cache reuse, host/path/version/generation isolation, no D1 hit gate')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
