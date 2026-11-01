'use strict'
// lib/apiCacheHygiene.ts: every /api/* response that names no cache policy of its own becomes `private, no-store`,
// and Cookie joins Vary. A route's own Cache-Control is kept byte for byte (the portal's public header, the no-store
// routes). The code runs after next(), so it also covers responses a route built with `new Response(...)`, the
// error handler's and a later middleware's early return, and it rebuilds a response whose headers are immutable.
//
// Real transpiled lib/apiCacheHygiene.ts under real Hono. Each MUTANT is the same source with one defect, and the
// same assertions must FAIL on it: header set before next(), a route's header overwritten, Vary duplicated, headers
// assumed mutable.
//
// Run (from cloudflare/): node scripts/test-api-cache-hygiene-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const FILENAME = path.join(__dirname, '..', 'src', 'lib', 'apiCacheHygiene.ts')
const readSource = () => fs.readFileSync(FILENAME, 'utf8').split('\r\n').join('\n')

function loadHygiene(rewrite = (source) => source) {
  const filename = FILENAME
  const source = rewrite(readSource())
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(() => ({}), module, module.exports)
  return module.exports
}

class FrozenHeaders extends Headers {
  set() { throw new TypeError('Can\'t modify immutable headers.') }
  append() { throw new TypeError('Can\'t modify immutable headers.') }
  delete() { throw new TypeError('Can\'t modify immutable headers.') }
}

function immutableResponse(body, status, init) {
  const response = new Response(body, { status })
  Object.defineProperty(response, 'headers', { value: new FrozenHeaders(init) })
  return response
}

function buildApp(middleware, { onError = false } = {}) {
  const app = new Hono()
  app.use('/api/*', middleware)
  app.use('/api/gated/*', async (c) => c.json({ error: 'Maintenance is in progress.' }, 503))
  app.get('/api/plain', (c) => c.json({ ok: true }))
  app.get('/api/raw', () => new Response('raw body', { status: 200 }))
  app.get('/api/own-private', (c) => c.json({}, 200, { 'Cache-Control': 'private, max-age=30' }))
  app.get('/api/own-no-store', (c) => { c.header('Cache-Control', 'no-store'); return c.json({}) })
  app.get('/api/own-public', (c) => c.json({}, 200, { 'Cache-Control': 'public, no-cache', ETag: 'W/"abc"' }))
  app.get('/api/vary-encoding', (c) => c.json({}, 200, { Vary: 'Accept-Encoding' }))
  app.get('/api/vary-cookie', (c) => c.json({}, 200, { Vary: 'Cookie' }))
  app.get('/api/vary-lower', (c) => c.json({}, 200, { Vary: 'accept-encoding, cookie' }))
  app.get('/api/vary-star', (c) => c.json({}, 200, { Vary: '*' }))
  app.get('/api/vary-two-lines', () => {
    const headers = new Headers()
    headers.append('Vary', 'Accept-Encoding')
    headers.append('Vary', 'Origin')
    return new Response('{}', { headers })
  })
  app.get('/api/cookies', (c) => {
    c.header('Set-Cookie', 'a=1; Path=/', { append: true })
    c.header('Set-Cookie', 'b=2; Path=/', { append: true })
    return c.json({})
  })
  app.get('/api/redirect', () => Response.redirect('https://example.test/next', 302))
  app.get('/api/immutable', () => immutableResponse('payload', 207, { 'x-own': '1', 'content-type': 'text/plain', 'set-cookie': 'c=3; Path=/' }))
  app.get('/api/immutable-own', () => immutableResponse('payload', 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }))
  app.get('/api/throws', () => { throw new Error('forced') })
  if (onError) app.onError((error, c) => c.json({ success: false, error: error.message }, 500))
  return app
}

const reportFailure = console.error
console.error = () => {} // Hono's default error handler logs every deliberate throw below

const get = (app, route, init) => app.request(route, init)
const summary = (response) => ({ cc: response.headers.get('cache-control'), vary: response.headers.get('vary') })

async function assertHygiene(middleware) {
  const app = buildApp(middleware)
  const custom = buildApp(middleware, { onError: true })

  assert.deepEqual(summary(await get(app, '/api/plain')), { cc: 'private, no-store', vary: 'Cookie' }, 'a route with no policy becomes private, no-store with Vary: Cookie')
  assert.deepEqual(summary(await get(app, '/api/raw')), { cc: 'private, no-store', vary: 'Cookie' }, 'a response built with new Response() is covered too')
  assert.equal(await (await get(app, '/api/raw')).text(), 'raw body', 'the body is untouched')

  assert.equal((await get(app, '/api/own-private')).headers.get('cache-control'), 'private, max-age=30', "a route's own private header is kept byte for byte")
  assert.equal((await get(app, '/api/own-no-store')).headers.get('cache-control'), 'no-store', "a route's own no-store is kept byte for byte")
  const publicResponse = await get(app, '/api/own-public')
  assert.equal(publicResponse.headers.get('cache-control'), 'public, no-cache', "a route's own public header is kept byte for byte")
  assert.equal(publicResponse.headers.get('etag'), 'W/"abc"')
  assert.match(publicResponse.headers.get('vary'), /(^|,\s*)Cookie$/, 'Vary still gains Cookie on a public answer')

  assert.equal((await get(app, '/api/vary-encoding')).headers.get('vary'), 'Accept-Encoding, Cookie', 'Cookie is appended to an existing Vary')
  assert.equal((await get(app, '/api/vary-cookie')).headers.get('vary'), 'Cookie', 'Vary: Cookie stays as it is')
  assert.equal((await get(app, '/api/vary-lower')).headers.get('vary'), 'accept-encoding, cookie', 'a lower-case cookie token counts as present: no duplicate')
  assert.equal((await get(app, '/api/vary-star')).headers.get('vary'), '*', 'Vary: * is left alone')
  assert.equal((await get(app, '/api/vary-two-lines')).headers.get('vary'), 'Accept-Encoding, Origin, Cookie', 'two Vary lines gain one Cookie')

  for (const [label, response] of [
    ['an unhandled error (default handler)', await get(app, '/api/throws')],
    ['an unhandled error (app.onError)', await get(custom, '/api/throws')],
    ['an unmatched /api path', await get(app, '/api/nowhere')],
    ['a later middleware that answers 503 without reaching the route', await get(app, '/api/gated/anything')],
  ]) {
    assert.deepEqual(summary(response), { cc: 'private, no-store', vary: 'Cookie' }, `${label} carries both headers`)
  }
  assert.equal((await get(custom, '/api/throws')).status, 500)
  assert.equal((await get(app, '/api/gated/anything')).status, 503)

  const redirect = await get(app, '/api/redirect')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), 'https://example.test/next')
  assert.deepEqual(summary(redirect), { cc: 'private, no-store', vary: 'Cookie' }, 'a Response.redirect() (immutable headers) is rebuilt and covered')

  const immutable = await get(app, '/api/immutable')
  assert.equal(immutable.status, 207, 'the rebuild keeps the status')
  assert.equal(await immutable.text(), 'payload', 'the rebuild keeps the body')
  assert.equal(immutable.headers.get('x-own'), '1', 'the rebuild keeps the route headers')
  assert.deepEqual(summary(immutable), { cc: 'private, no-store', vary: 'Cookie' })
  assert.deepEqual(immutable.headers.getSetCookie(), ['c=3; Path=/'], 'the rebuild keeps Set-Cookie')
  assert.deepEqual(summary(await get(app, '/api/immutable-own')), { cc: 'private, no-store', vary: 'Cookie' }, 'an immutable response that already complies is not touched or broken')

  assert.deepEqual((await get(app, '/api/cookies')).headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/'], 'both cookies survive')

  const hostile = await get(app, '/api/plain', { headers: { 'Cache-Control': 'public, max-age=999', Pragma: 'cache', Vary: 'Cookie', 'X-Forwarded-Proto': 'https' } })
  assert.deepEqual(summary(hostile), { cc: 'private, no-store', vary: 'Cookie' }, 'request headers cannot change the response policy')
}

const MUTANTS = {
  'sets the header before next()': (source) => source.replace(/export async function apiCacheHygiene[\s\S]*$/, [
    'export async function apiCacheHygiene(c: Context, next: Next): Promise<void> {',
    "  c.header('Cache-Control', DEFAULT_API_CACHE_CONTROL)",
    "  c.header('Vary', 'Cookie')",
    '  await next()',
    '}',
    '',
  ].join('\n')),
  'overwrites the route header': (source) => source.replace("if (!headers.has('Cache-Control')) headers.set(", 'headers.set('),
  'appends Cookie to Vary without checking': (source) => source.replace(/  const existing = headers\.get\('Vary'\)[\s\S]*?\n\}\n/, "  headers.append('Vary', token)\n}\n"),
  'assumes the headers are mutable': (source) => source.replace(/  \} catch \{[\s\S]*?\n  \}\n\}/, '  } catch (error) {\n    throw error\n  }\n}'),
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  const real = loadHygiene()
  await check('apiCacheHygiene: private, no-store by default, own header kept, Vary: Cookie once, errors and immutable headers covered', async () => {
    await assertHygiene(real.apiCacheHygiene)
  })

  for (const [name, mutate] of Object.entries(MUTANTS)) {
    await check(`MUTANT ${name}: the same assertions fail`, async () => {
      const source = readSource()
      assert.notEqual(mutate(source), source, 'the mutation must actually change lib/apiCacheHygiene.ts')
      await assert.rejects(() => assertHygiene(loadHygiene(mutate).apiCacheHygiene), { name: 'AssertionError' })
    })
  }

  await check('appendVary: exact tokens, never a duplicate, never after *', async () => {
    const cases = [[null, 'Cookie'], ['', 'Cookie'], ['Accept-Encoding', 'Accept-Encoding, Cookie'], ['Cookie', 'Cookie'], ['COOKIE, Origin', 'COOKIE, Origin'], ['Cookie-Extra', 'Cookie-Extra, Cookie'], ['*', '*']]
    for (const [before, after] of cases) {
      const headers = new Headers()
      if (before !== null) headers.set('Vary', before)
      real.appendVary(headers, 'Cookie')
      assert.equal(headers.get('Vary'), after, `Vary ${JSON.stringify(before)}`)
    }
  })

  await check('source lock: registered right after the metrics wrapper, before every other /api/* middleware', async () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8').split('\r\n').join('\n')
    const uses = [...index.matchAll(/^app\.use\('\/api\/\*', (\w+)/gm)].map((match) => match[1])
    assert.equal(uses[0], 'requestMetricsMiddleware')
    assert.equal(uses[1], 'apiCacheHygiene')
    assert.match(index, /import \{ apiCacheHygiene \} from '\.\/lib\/apiCacheHygiene'/)
    assert.equal(/c\.res\.headers\.set\(['"]cache-control/i.test(readSource()), false, 'no unconditional write of a fixed header')
  })

  console.log(`\n${passed} api cache hygiene checks passed.`)
}

main().catch((error) => {
  reportFailure(error)
  process.exit(1)
})
