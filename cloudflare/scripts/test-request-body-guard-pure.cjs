// Real Hono + transpiled production modules; no SQL engine, network or files written.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

function load(relative, dependencies = {}) {
  const filename = path.join(__dirname, '../src', relative)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  })
  const module = { exports: {} }
  const poisoned = new Proxy({}, { get: (_, key) => {
    if (key === '__esModule') return true
    return () => { throw new Error(`Unexpected dependency effect: ${relative}:${String(key)}`) }
  } })
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'hono') return { Hono }
    return poisoned
  }, module, module.exports)
  return module.exports
}

function streamRequest(url, bytes, length, options = {}) {
  let offset = 0
  const state = { cancelled: false, pulls: 0 }
  const body = new ReadableStream({
    pull(controller) {
      state.pulls++
      if (options.fail) throw new Error('broken reader')
      if (offset === bytes.length) { controller.close(); return }
      const end = Math.min(bytes.length, offset + (options.chunkSize || 4093))
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
    cancel() { state.cancelled = true },
  }, { highWaterMark: 0 })
  const headers = { 'content-type': options.contentType || 'application/json', 'x-preserved': 'yes' }
  if (length !== undefined) headers['content-length'] = length
  return { request: new Request(url, { method: 'POST', body, headers, duplex: 'half' }), state }
}

async function main() {
  const { admitRequestBody, smallBodyAccess, SMALL_BODY_BYTES: small, PORTAL_SCREENSHOT_BODY_BYTES: large } = load('lib/requestBodyGuard.ts')
  let effects = 0
  const app = new Hono()
  app.onError((_, c) => c.json({ error: 'generic handler' }, 500))
  app.use('*', async (c, next) => { await next(); c.header('X-Content-Type-Options', 'nosniff') })
  app.use('*', async (c, next) => {
    const rejection = await admitRequestBody(c, c.req.path === '/screenshots' ? large : small)
    if (rejection) return rejection
    return next()
  })
  app.post('*', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    // Reproduce a parser catch that must NEVER get to turn overflow into success.
    const parsed = await c.req.json().catch(() => ({}))
    effects++
    return c.json({ size: bytes.length, parsed, header: c.req.header('x-preserved'), url: c.req.url })
  })
  for (const limit of [small, large]) {
    const route = limit === small ? '/' : '/screenshots'
    for (const length of [undefined, '1', 'invalid', '-1', String(limit)]) {
      for (const size of [0, limit, limit + 1]) {
        const bytes = new Uint8Array(size).fill(32)
        if (size >= 3) bytes.set(new TextEncoder().encode('€'), size - 3)
        const { request, state } = streamRequest(`https://unit.test${route}`, bytes, length)
        const before = effects
        const response = await app.fetch(request)
        assert.equal(response.status, size > limit ? 413 : 200)
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
        const result = await response.json()
        if (size > limit) {
          assert.equal(result.code, 'request_body_too_large')
          assert.equal(result.maxBytes, limit)
          assert.equal(state.cancelled, true)
          assert.equal(effects, before)
        } else {
          assert.equal(result.size, size)
          assert.equal(result.header, 'yes')
        }
      }
    }
  }
  // Large declared bodies are cancelled without a pull, even if actual bytes are small.
  const declared = streamRequest('https://unit.test/', new Uint8Array(2), String(small + 1))
  assert.equal((await app.fetch(declared.request)).status, 413)
  assert.deepEqual(declared.state, { cancelled: true, pulls: 0 })
  const broken = streamRequest('https://unit.test/', new Uint8Array(2), undefined, { fail: true })
  const beforeBroken = effects
  assert.equal((await app.fetch(broken.request)).status, 400)
  assert.equal(effects, beforeBroken)
  const json = { note: 'ខ្មែរ € 😀', nested: { number: 42 } }
  const jsonResponse = await app.fetch(streamRequest('https://unit.test/?q=keep', new TextEncoder().encode(JSON.stringify(json))).request)
  assert.deepEqual((await jsonResponse.json()).parsed, json)
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const exactJson = new Uint8Array(small).fill(32); exactJson.set(jsonBytes)
  const tinyChunks = await app.fetch(streamRequest('https://unit.test/', exactJson, '0', { chunkSize: 1 }).request)
  assert.equal(tinyChunks.status, 200)
  assert.deepEqual((await tinyChunks.json()).parsed, json, 'exact-size JSON survives one-byte chunking')

  // Multipart survives admission byte-for-byte and remains parseable by Hono.
  const formApp = new Hono()
  formApp.post('/', async (c) => {
    const rejection = await admitRequestBody(c, small)
    if (rejection) return rejection
    const bytes = Buffer.from(await c.req.raw.clone().arrayBuffer())
    const form = await c.req.formData()
    return c.json({ bytes: bytes.toString('base64'), note: form.get('note') })
  })
  const form = new FormData(); form.set('note', 'ខ្មែរ 😀')
  const formRequest = new Request('https://unit.test/', { method: 'POST', body: form })
  const formBytes = new Uint8Array(await formRequest.arrayBuffer())
  const formResponse = await formApp.fetch(streamRequest('https://unit.test/', formBytes, '1', { contentType: formRequest.headers.get('content-type') }).request)
  assert.deepEqual(await formResponse.json(), { bytes: Buffer.from(formBytes).toString('base64'), note: 'ខ្មែរ 😀' })

  // Exact classification: no broad auth prefix or payload/content-type exemptions.
  for (const route of ['/api/import-jobs/abc/csv', '/api/import-jobs/%61/zip', '/api/sync/outbox', '/api/sync/uploads/a/chunk', '/api/settings', '/api/products/bulk', '/api/files/upload', '/api/auth/login/', '/api/auth/%6cogin', '/api/backups/other', '/api/portal/submissions', '/api/portal/submissions/1/review']) {
    assert.equal(smallBodyAccess('POST', route), null, route)
  }
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) assert.equal(smallBodyAccess(method, '/api/auth/login'), null)

  // Execute the actual index middleware order and actual portal/backup handlers.
  const calls = { bootstrap: 0, maintenance: 0, rate: 0, settings: 0, effect: 0 }
  let authenticated = false, backup = false, restore = false, admin = false, enabled = true, allowed = true
  const auth = {
    getSessionUser: async () => authenticated ? { id: 1 } : null,
    requireAuth: async (c, next) => {
      if (!authenticated) return c.json({ error: 'Unauthorized' }, 401)
      c.set('user', { id: 1 }); return next()
    },
  }
  const permissions = { hasPermission: (_, key) => key === 'backup' ? backup : restore, isAdminControlUser: () => admin }
  const guard = { admitRequestBody, smallBodyAccess, SMALL_BODY_BYTES: small, PORTAL_SCREENSHOT_BODY_BYTES: large }
  const portal = load('routes/portal.ts', {
    '../lib/requestBodyGuard': guard, '../lib/auth': auth,
    '../lib/rateLimit': { getClientIp: () => 'unit', checkRateLimit: async () => { calls.rate++; return { allowed, retryAfterSeconds: 1 } } },
    '../lib/db': { getDb: () => ({ prepare: (sql) => {
      assert.match(sql, /^SELECT key, value FROM settings$/)
      calls.settings++
      return { all: async () => ['customer_portal_ai_enabled', 'customer_portal_submission_enabled'].map(key => ({ key, value: String(enabled) })) }
    } }) },
  }).default
  const backups = load('routes/backups.ts', { '../lib/auth': auth, '../lib/permissions': permissions })
  const devices = load('routes/devices.ts', { '../lib/auth': auth, '../lib/permissions': permissions })
  const authRoutes = new Hono()
  authRoutes.post('*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/devices/')) return next()
    if (smallBodyAccess(c.req.method, c.req.path) === 'staff' && !authenticated) return c.json({ error: 'Unauthorized' }, 401)
    await c.req.json().catch(() => ({})); calls.effect++; return c.json({ ok: true })
  })
  const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
  const routes = Object.fromEntries([...indexSource.matchAll(/import \w+ from '(\.\/routes\/[^']+)'/g)].map(([, name]) => [name, { __esModule: true, default: new Hono() }]))
  const worker = load('index.ts', {
    ...routes,
    './routes/portal': { __esModule: true, default: portal },
    './routes/backups': backups,
    './routes/devices': devices,
    './routes/auth': { __esModule: true, default: authRoutes },
    './routes/sync': { createSyncRoute: () => new Hono() },
    './lib/requestBodyGuard': guard, './lib/auth': auth, './lib/permissions': permissions,
    './lib/coreDataInvariants': { ensureCoreDataInvariantsOnce: async () => { calls.bootstrap++ } },
    './lib/maintenance': { isMaintenanceGatedRequest: () => true, getMaintenance: async () => { calls.maintenance++; return null } },
    './lib/errorReporting': { reportError: async () => {} },
  }).default
  const ctx = { waitUntil() {} }
  const env = { BUSINESS_OS_PUBLIC_URL: 'https://unit.test' }
  async function send(route, size, length, extra = {}) {
    return worker.fetch(streamRequest(`https://unit.test${route}`, new Uint8Array(size).fill(32), length, extra).request, env, ctx)
  }
  for (const route of ['/api/auth/login', '/api/auth/password-reset/complete', '/api/portal/auth/signup', '/api/portal/auth/signin', '/api/portal/auth/signout']) {
    const before = { ...calls }
    const response = await send(route, small + 1, '1')
    assert.equal(response.status, 413, route)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(calls, before, 'public rejection before ALL downstream effects')
  }
  // Actual router strictness: a trailing slash or encoded literal must not
  // reach an unguarded version of a public auth/submission handler.
  for (const route of ['/api/portal/auth/signup/', '/api/portal/submissions/']) {
    assert.equal((await send(route, small + 1, '1')).status, 404, route)
  }
  assert.equal((await send('/api/portal/auth/%73ignup', small + 1, '1')).status, 413)
  assert.equal((await send('/api/portal/%73ubmissions', large + 1, '1')).status, 413)
  for (const route of ['/api/auth/session-duration', '/api/auth/devices/sessions/revoke-user', '/api/backups', '/api/backups/maintenance/clear']) {
    assert.equal((await send(route, small + 1)).status, 401, route)
  }
  authenticated = true
  assert.equal((await send('/api/auth/devices/sessions/revoke-user', small + 1)).status, 403)
  admin = true
  assert.equal((await send('/api/auth/devices/sessions/revoke-user', small + 1)).status, 413)
  assert.equal((await send('/api/backups', small + 1)).status, 403)
  backup = true
  assert.equal((await send('/api/backups/maintenance/clear', small + 1)).status, 403)
  restore = true
  for (const route of ['/api/backups', '/api/backups/maintenance/clear', '/api/auth/session-duration']) {
    assert.equal((await send(route, small + 1, '1')).status, 413, route)
  }
  for (const [route, limit] of [['/api/portal/ai/chat', small], ['/api/portal/submissions', large]]) {
    const response = await send(route, limit + 1, '1')
    assert.equal(response.status, 413, route)
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN')
    // At the exact limit the real parser/validator runs (blank body -> 400).
    assert.equal((await send(route, limit)).status, 400, route)
    enabled = false
    assert.equal((await send(route, limit + 1)).status, 403, route)
    enabled = true; allowed = false
    assert.equal((await send(route, limit + 1)).status, 429, route)
    allowed = true
  }
  // Existing client screenshot ceiling fits: eight 2,000,000-character images
  // plus JSON metadata. Stop at the real membership validator, before effects.
  const screenshots = Array(8).fill('data:image/png;base64,' + 'A'.repeat(2_000_000 - 22))
  const screenshotBody = new TextEncoder().encode(JSON.stringify({ screenshots, membershipNumber: '' }))
  assert.ok(screenshotBody.byteLength < large)
  const screenshotResponse = await worker.fetch(streamRequest('https://unit.test/api/portal/submissions', screenshotBody).request, env, ctx)
  assert.equal(screenshotResponse.status, 400)
  assert.equal((await screenshotResponse.json()).error, 'Membership number is required')
  assert.equal(calls.effect, 0)
  console.log('PASS request admission: byte boundaries, cancellation, parser preservation, exact scope, real index/portal/backups, 401/403/429 and no downstream effects')
}

module.exports = { load, streamRequest }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
