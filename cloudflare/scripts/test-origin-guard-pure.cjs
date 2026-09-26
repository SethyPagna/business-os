// F4 (Release 1 auth audit). The session cookie rides on any request the
// browser sends, and the Worker had no Origin / Fetch-Metadata check, so a
// hostile page could fire a "simple" cross-site write (a form POST or a
// text/plain fetch) at /api with the victim's session attached.
//
// lib/originGuard.ts refuses POST/PUT/PATCH/DELETE on /api/* unless Origin
// equals the request origin, Sec-Fetch-Site is same-origin/none, or both
// headers are absent (non-browser clients). The Telegram webhook is exempt.
// index.ts mounts it once, ahead of the body-admission and seeding work.
//
// Drives the REAL lib/originGuard.ts through a Hono app. Fails on a04da325
// (the module does not exist there).
//
// Run: node scripts/test-origin-guard-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

function loadGuard() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'originGuard.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}

let appCache = null
function guardedApp() {
  if (appCache) return appCache
  const { originGuard } = loadGuard()
  const app = new Hono()
  app.use('/api/*', originGuard)
  const ok = (c) => c.json({ ok: true })
  app.post('/api/users', ok)
  app.put('/api/users/1', ok)
  app.patch('/api/users/1', ok)
  app.delete('/api/users/1', ok)
  app.get('/api/users', ok)
  app.post('/api/telegram/webhook', ok)
  app.post('/uploads/x', ok)
  appCache = app
  return app
}

const ADMIN = 'https://admin.leangbeauty.com'
async function send(method, pathname, headers = {}, base = ADMIN) {
  const res = await guardedApp().request(`${base}${pathname}`, { method, headers })
  return res.status
}

async function main() {
  await check('a cross-site simple write is refused on every mutating method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const pathname = method === 'POST' ? '/api/users' : '/api/users/1'
      assert.equal(await send(method, pathname, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), 403, `${method} cross-site`)
    }
  })

  await check('a sibling subdomain, an opaque null origin, or a foreign Origin alone is refused', async () => {
    assert.equal(await send('POST', '/api/users', { origin: 'https://leangbeauty.com', 'sec-fetch-site': 'same-site' }), 403, 'same-site is not same-origin')
    assert.equal(await send('POST', '/api/users', { origin: 'null', 'sec-fetch-site': 'cross-site' }), 403, 'sandboxed iframe')
    assert.equal(await send('POST', '/api/users', { origin: 'https://evil.example' }), 403, 'older browser: Origin only')
    assert.equal(await send('POST', '/api/users', { 'sec-fetch-site': 'cross-site' }), 403, 'Fetch-Metadata only')
    assert.equal(await send('POST', '/api/users', { origin: 'http://admin.leangbeauty.com' }), 403, 'scheme is part of the origin')
  })

  await check('same-origin browser writes, user-initiated requests and non-browser clients pass', async () => {
    assert.equal(await send('POST', '/api/users', { origin: ADMIN, 'sec-fetch-site': 'same-origin' }), 200)
    assert.equal(await send('POST', '/api/users', { origin: ADMIN }), 200, 'Origin equal, no Fetch-Metadata')
    assert.equal(await send('POST', '/api/users', { 'sec-fetch-site': 'same-origin' }), 200)
    assert.equal(await send('POST', '/api/users', { 'sec-fetch-site': 'none' }), 200)
    assert.equal(await send('DELETE', '/api/users/1', {}), 200, 'curl / cron / server-to-server')
    // Vite dev proxy: the browser talks to :5173 (same-origin) and the proxy
    // forwards to the Worker with Origin still naming :5173.
    assert.equal(await send('POST', '/api/users', { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' }, 'http://localhost:8787'), 200)
  })

  await check('reads, non-/api paths and the Telegram webhook are untouched', async () => {
    const hostile = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }
    assert.equal(await send('GET', '/api/users', hostile), 200)
    assert.equal(await send('POST', '/uploads/x', hostile), 200)
    assert.equal(await send('POST', '/api/telegram/webhook', { 'sec-fetch-site': 'cross-site', origin: 'https://api.telegram.org' }), 200)
  })

  await check('the refusal is a JSON 403 with a stable code', async () => {
    const res = await guardedApp().request(`${ADMIN}/api/users`, { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.code, 'cross_origin_write_refused')
  })

  await check('source lock: index.ts mounts the guard once, before body admission and seeding', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const mounts = index.match(/app\.use\('\/api\/\*', originGuard\)/g) || []
    assert.equal(mounts.length, 1, 'mounted exactly once')
    const at = index.indexOf("app.use('/api/*', originGuard)")
    assert.ok(at < index.indexOf('ensureCoreDataInvariantsOnce(c.env)'), 'before core-data seeding')
    assert.ok(at < index.indexOf("smallBodyAccess(c.req.method, c.req.path) === 'public'"), 'before public body admission')
    assert.ok(at < index.indexOf("app.route('/api/settings', settingsRoute)"), 'before every route')
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-origin-guard-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-origin-guard-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
