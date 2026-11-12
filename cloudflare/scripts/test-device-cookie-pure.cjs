// Device identity cookie (owner 12 Nov 2026, "repeated ask for permission").
// The signed HttpOnly `__Host-bos_dev` cookie is the device id's main home; the
// body id from localStorage is the fallback. Drives the REAL routes/auth.ts
// (harness/load_auth_route.cjs, every migration applied) with the REAL
// lib/deviceTrust.ts, lib/deviceCookie.ts and lib/permissions.ts.
//
// Run: node scripts/test-device-cookie-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')

function loadTs(rel, overrides, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return loadTs(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`, overrides, cache)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const UA = 'Mozilla/5.0 (iPhone) Safari'
const COOKIE = '__Host-bos_dev'

function setup(envPatch = {}) {
  let deviceTrust = null
  const h = createAuthHarness({
    overrides: {
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  Object.assign(h.env, envPatch)
  const stubs = { './db': { getDb: () => h.db }, './audit': { audit: async () => {} } }
  deviceTrust = loadTs('lib/deviceTrust.ts', stubs)
  const cookieLib = loadTs('lib/deviceCookie.ts', stubs)
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES
    (1, 'admin', 'Administrator', '{"all":true}', 1),
    (2, 'cashier', 'Cashier', '{"pos":true,"sales":true}', 0)`).run({})
  h.addUser({ id: 10, username: 'sokha', name: 'Sokha', roleCode: 'cashier' })
  h.addUser({ id: 11, username: 'owner', name: 'Owner', roleCode: 'admin' })
  return { h, cookieLib }
}

const rows = (h, userId = 10) => h.raw.prepare('SELECT device_id, status FROM trusted_devices WHERE user_id = @userId ORDER BY id').all({ userId }).map((row) => ({ device_id: row.device_id, status: row.status }))
const approve = (h, deviceId, userId = 10) => h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at)
  VALUES (@userId, @deviceId, 'Phone', 'approved', CURRENT_TIMESTAMP)`).run({ userId, deviceId })

async function signIn(h, { username = 'sokha', deviceId, cookie } = {}) {
  const headers = { 'User-Agent': UA }
  if (cookie) headers.Cookie = `${COOKIE}=${cookie}`
  return h.request('/login', 'POST', { username, password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers })
}

function deviceSetCookie(res) {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${COOKIE}=`)) || null
}

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    const detail = 'actual' in error ? ` actual=${JSON.stringify(error.actual)} expected=${JSON.stringify(error.expected)}` : ''
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}${detail}`.slice(0, 600))
  }
}

const cookieIdOf = (line) => decodeURIComponent(line.split(';')[0].slice(COOKIE.length + 1)).split('.')[0]

async function main() {
  await check('1. a tampered cookie is ignored: the body id decides and the bad cookie is replaced', async () => {
    const { h, cookieLib } = setup()
    approve(h, 'body-device-0001')
    const good = await cookieLib.signDeviceCookieValue(h.env, 'forged-device-0001')
    const mac = good.split('.')[1]
    const forgeries = [`forged-device-0001.${mac.slice(0, -2)}AA`, `other-device-0009.${mac}`, 'forged-device-0001', `forged-device-0001.${mac}.x`, '.', '']
    for (const cookie of forgeries) {
      const res = await signIn(h, { deviceId: 'body-device-0001', cookie })
      assert.equal(res.body.success, true, `body id signs in despite cookie ${cookie.slice(0, 24)}`)
      assert.equal(res.body.deviceId, 'body-device-0001')
      assert.equal(cookieIdOf(deviceSetCookie(res)), 'body-device-0001', 'the response pins a fresh valid cookie')
    }
    assert.deepEqual(rows(h).map((r) => r.device_id), ['body-device-0001'], 'no pending row for the forged ids')
  })

  await check('2. an approved cookie wins over a different, unknown body id', async () => {
    const { h, cookieLib } = setup()
    approve(h, 'cookie-device-0001')
    const cookie = await cookieLib.signDeviceCookieValue(h.env, 'cookie-device-0001')
    const res = await signIn(h, { deviceId: 'stale-local-0001', cookie })
    assert.equal(res.body.success, true)
    assert.equal(res.body.deviceId, 'cookie-device-0001', 'the response tells the browser which id won')
    assert.deepEqual(rows(h).map((r) => r.device_id), ['cookie-device-0001'], 'no new pending row for the stale body id')
  })

  await check('2b. an approved body id wins over a different cookie id that is only pending', async () => {
    const { h, cookieLib } = setup()
    approve(h, 'body-device-0002')
    h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'cookie-pending-0002', 'pending')`).run({})
    const cookie = await cookieLib.signDeviceCookieValue(h.env, 'cookie-pending-0002')
    const res = await signIn(h, { deviceId: 'body-device-0002', cookie })
    assert.equal(res.body.success, true, 'the approved id is adopted')
    assert.equal(cookieIdOf(deviceSetCookie(res)), 'body-device-0002', 'the cookie is re-pinned to the approved id')
    assert.equal(rows(h).length, 2, 'nothing new was inserted')
  })

  await check('3. an approved body id with no cookie is adopted: no pending row, cookie issued', async () => {
    const { h } = setup()
    approve(h, 'local-device-0003')
    const res = await signIn(h, { deviceId: 'local-device-0003' })
    assert.equal(res.body.success, true)
    assert.equal(res.body.deviceId, 'local-device-0003')
    assert.equal(cookieIdOf(deviceSetCookie(res)), 'local-device-0003')
    assert.deepEqual(rows(h), [{ device_id: 'local-device-0003', status: 'approved' }])
  })

  await check('4. both ids unknown makes exactly one pending row, and a retry makes no second', async () => {
    const { h, cookieLib } = setup()
    const cookie = await cookieLib.signDeviceCookieValue(h.env, 'cookie-new-0004')
    const first = await signIn(h, { deviceId: 'body-new-0004', cookie })
    assert.equal(first.body.deviceApprovalRequired, true)
    assert.equal(first.body.deviceStatus, 'pending')
    assert.equal(first.body.deviceId, 'cookie-new-0004')
    const retry = await signIn(h, { deviceId: 'body-new-0004', cookie: await cookieLib.signDeviceCookieValue(h.env, cookieIdOf(deviceSetCookie(first))) })
    assert.equal(retry.body.deviceApprovalRequired, true)
    const adopted = await signIn(h, { deviceId: first.body.deviceId })
    assert.equal(adopted.body.deviceApprovalRequired, true, 'the browser stores the id the response named, and sends it even with no cookie')
    assert.equal(rows(h).length, 1, 'one row however many tries and whichever id the browser sent')
    assert.equal(rows(h)[0].status, 'pending')
  })

  await check('4b. a pending body id is kept over an unknown cookie id (a retry reuses the existing row)', async () => {
    const { h, cookieLib } = setup()
    h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'body-pending-0005', 'pending')`).run({})
    const cookie = await cookieLib.signDeviceCookieValue(h.env, 'cookie-unknown-0005')
    const res = await signIn(h, { deviceId: 'body-pending-0005', cookie })
    assert.equal(res.body.deviceApprovalRequired, true)
    assert.equal(rows(h).length, 1)
  })

  await check('5. administrator accounts stay exempt: no row, no device cookie, no deviceId echoed', async () => {
    const { h } = setup()
    const res = await signIn(h, { username: 'owner', deviceId: 'admin-device-0006' })
    assert.equal(res.body.success, true)
    assert.equal(rows(h, 11).length, 0)
    assert.equal(deviceSetCookie(res), null)
    assert.equal('deviceId' in res.body, false)
  })

  await check('6. the cookie attributes are exactly host-only, HttpOnly, Secure, Lax, Path=/, 399 days', async () => {
    const { h } = setup()
    approve(h, 'attr-device-0007')
    const line = deviceSetCookie(await signIn(h, { deviceId: 'attr-device-0007' }))
    const [pair, ...attributes] = line.split('; ')
    assert.match(pair, /^__Host-bos_dev=attr-device-0007\.[A-Za-z0-9_-]{43}$/, 'id.base64url(HMAC-SHA256)')
    assert.deepEqual(attributes.sort(), ['HttpOnly', 'Max-Age=34473600', 'Path=/', 'SameSite=Lax', 'Secure'].sort())
    assert.ok(!/domain=/i.test(line), 'no Domain attribute: never sent to the storefront host')
  })

  await check('7. logout leaves the device cookie alone', async () => {
    const logout = read('routes/auth.ts')
    const block = logout.slice(logout.indexOf("app.post('/logout'"), logout.indexOf("app.post('/logout'") + 3500)
    assert.ok(!/DEVICE_COOKIE_NAME|bos_dev|pinDeviceCookie|deleteCookie\([^)]*dev/.test(block.slice(0, block.indexOf("app.", 40))), 'logout never touches the device cookie')
    const { h } = setup()
    const res = await h.request('/logout', 'POST', {}, { actorId: 10 })
    assert.equal(res.headers.getSetCookie().some((line) => line.includes('bos_dev')), false)
  })

  await check('8. the cookie is set only by the sign-in endpoints, never by a helper any route can call', async () => {
    const all = fs.readdirSync(path.join(SRC, 'routes')).concat(fs.readdirSync(path.join(SRC, 'lib')).map((f) => `../lib/${f}`))
    const users = all.filter((rel) => /pinDeviceCookie|resolveAndPinDevice|DEVICE_COOKIE_NAME/.test(read(rel.startsWith('../lib/') ? rel.slice(3) : `routes/${rel}`)))
    assert.deepEqual(users.sort(), ['../lib/deviceCookie.ts', 'auth.ts'].sort())
    const auth = read('routes/auth.ts')
    for (const [start, end] of [["app.post('/login'", "app.post('/logout'"], ["app.post('/otp/verify'", '// POST /api/auth/session-duration'], ["app.get('/oauth/callback'", 'app.post(\'/oauth/complete\'']]) {
      const block = auth.slice(auth.indexOf(start), auth.indexOf(end, auth.indexOf(start)))
      assert.ok(block.includes('resolveAndPinDevice('), `${start} resolves the device through the cookie`)
      assert.ok(block.indexOf('resolveAndPinDevice(') < block.indexOf('checkDeviceTrust('), `${start} resolves before the gate`)
      assert.ok(block.indexOf('requiresDeviceApproval(') < block.indexOf('resolveAndPinDevice('), `${start} resolves only for accounts the gate applies to`)
    }
  })

  await check('9. without APP_ENCRYPTION_KEY no cookie is issued or trusted and the body id still works', async () => {
    const { h } = setup({ APP_ENCRYPTION_KEY: undefined })
    approve(h, 'nokey-device-0008')
    const res = await signIn(h, { deviceId: 'nokey-device-0008', cookie: 'nokey-device-0008.AAAA' })
    assert.equal(res.body.success, true)
    assert.equal(deviceSetCookie(res), null)
  })

  await check('10. a malformed body id (too long, bad characters) is refused as missing and creates no row', async () => {
    const { h } = setup()
    for (const deviceId of ['x'.repeat(101), 'bad id with spaces', "x'; DROP TABLE users;--", 'short', undefined]) {
      const res = await signIn(h, { deviceId })
      assert.equal(res.body.deviceApprovalRequired, true, String(deviceId).slice(0, 20))
    }
    assert.equal(rows(h).length, 0)
  })

  await check('11. a parallel first sign-in loses the insert race quietly (ON CONFLICT DO NOTHING)', async () => {
    const { h } = setup()
    const trust = read('lib/deviceTrust.ts')
    assert.match(trust, /VALUES \(@user_id, @device_id[^)]*\)\s+ON CONFLICT\(user_id, device_id\) DO NOTHING/)
    const sql = /INSERT INTO trusted_devices[\s\S]*?DO NOTHING/.exec(trust)[0]
    const params = { user_id: 10, device_id: 'race-device-0009', device_name: null, user_agent: null, ip: null, country: null, status: 'pending', decided_at: null }
    h.raw.prepare(sql).run(params)
    assert.doesNotThrow(() => h.raw.prepare(sql).run(params))
    assert.equal(rows(h).length, 1)
  })

  await check('12. D1 calls: the cookie costs nothing when the ids agree, one read when they differ', async () => {
    const { h, cookieLib } = setup()
    approve(h, 'calls-device-0010')
    approve(h, 'calls-device-0011')
    const cookieFor = (id) => cookieLib.signDeviceCookieValue(h.env, id)
    const count = async (options) => {
      let calls = 0
      const original = h.db.prepare.bind(h.db)
      h.db.prepare = (sql) => {
        const stmt = original(sql)
        return new Proxy(stmt, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => { calls += 1; return target[key](...args) } : target[key]) })
      }
      try { await signIn(h, options) } finally { h.db.prepare = original }
      return calls
    }
    await signIn(h, { deviceId: 'calls-device-0010' })
    await count({ deviceId: 'calls-device-0010' })
    const bodyOnly = await count({ deviceId: 'calls-device-0010' })
    const agreeing = await count({ deviceId: 'calls-device-0010', cookie: await cookieFor('calls-device-0010') })
    const differing = await count({ deviceId: 'calls-device-0010', cookie: await cookieFor('calls-device-0011') })
    console.log(`     approved /login D1 statements: body only ${bodyOnly}, cookie agrees ${agreeing}, cookie differs ${differing}`)
    assert.equal(agreeing, bodyOnly, 'a matching cookie adds no D1 call')
    assert.equal(differing, bodyOnly + 1, 'a differing cookie adds exactly one read')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  console.log('test-device-cookie-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
