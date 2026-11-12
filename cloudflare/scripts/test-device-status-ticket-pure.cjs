// A waiting device continues by itself (owner 12 Nov 2026). The pending
// sign-in answer carries a short-lived signed ticket; POST /device-status turns
// it into "has the admin decided?" (one read, never a session); the bell shows
// pending devices again and a NEW pending row raises one broadcast.
// Drives the REAL routes/auth.ts (harness/load_auth_route.cjs) with the REAL
// lib/deviceTrust.ts and lib/deviceCookie.ts over every migration in SQLite.
//
// Run: node scripts/test-device-status-ticket-pure.cjs
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

function setup(envPatch = {}) {
  let deviceTrust = null
  const broadcasts = []
  const h = createAuthHarness({
    overrides: {
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  Object.assign(h.env, envPatch)
  const stubs = {
    './db': { getDb: () => h.db },
    './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async (_env, channel, payload) => { broadcasts.push({ channel, payload }) } },
  }
  deviceTrust = loadTs('lib/deviceTrust.ts', stubs)
  const lib = loadTs('lib/deviceCookie.ts', stubs)
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES
    (1, 'admin', 'Administrator', '{"all":true}', 1),
    (2, 'cashier', 'Cashier', '{"pos":true,"sales":true}', 0)`).run({})
  h.addUser({ id: 10, username: 'sokha', name: 'Sokha', roleCode: 'cashier' })
  h.addUser({ id: 11, username: 'owner', name: 'Owner', roleCode: 'admin' })
  return { h, lib, broadcasts }
}

const signIn = (h, deviceId, username = 'sokha') => h.request('/login', 'POST', { username, password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers: { 'User-Agent': 'UA' } })
// The browser that waited holds the device cookie its pending sign-in issued; an approved id is only honoured with it.
const signInWithCookie = async (h, lib, deviceId) => h.request('/login', 'POST', { username: 'sokha', password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers: { 'User-Agent': 'UA', Cookie: `__Host-bos_dev=${await lib.signDeviceCookieValue(h.env, deviceId)}` } })
const status = (h, ticket) => h.request('/device-status', 'POST', { ticket })
const rowStatus = (h, deviceId) => h.raw.prepare('SELECT status FROM trusted_devices WHERE user_id = 10 AND device_id = @deviceId').get({ deviceId })?.status
const decide = (h, deviceId, value) => h.raw.prepare('UPDATE trusted_devices SET status = @value WHERE user_id = 10 AND device_id = @deviceId').run({ value, deviceId })

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

async function main() {
  await check('the ticket is bound to user, device and expiry, and to its own purpose', async () => {
    const { h, lib } = setup()
    const ticket = await lib.issueDeviceTicket(h.env, 10, 'ticket-device-0001')
    assert.deepEqual(await lib.readDeviceTicket(h.env, ticket), { userId: 10, deviceId: 'ticket-device-0001' })
    const [user, device, expires, mac] = ticket.split('.')
    for (const forged of [`11.${device}.${expires}.${mac}`, `${user}.other-device-0002.${expires}.${mac}`, `${user}.${device}.${Number(expires) + 600}.${mac}`, `${user}.${device}.${expires}.${mac.slice(0, -2)}AA`, `${user}.${device}.${expires}`, `${ticket}.x`, '', 'a.b.c.d']) {
      assert.equal(await lib.readDeviceTicket(h.env, forged), null, `refused: ${forged.slice(0, 40)}`)
    }
    const cookieValue = await lib.signDeviceCookieValue(h.env, 'ticket-device-0001')
    assert.equal(await lib.readDeviceTicket(h.env, `10.ticket-device-0001.${expires}.${cookieValue.split('.')[1]}`), null, 'a cookie MAC cannot pass as a ticket')
    assert.equal(await lib.verifyDeviceCookieValue(h.env, `ticket-device-0001.${mac}`), null, 'a ticket MAC cannot pass as a cookie')
    const realNow = Date.now
    Date.now = () => realNow() + (lib.DEVICE_TICKET_TTL_SECONDS + 5) * 1000
    try { assert.equal(await lib.readDeviceTicket(h.env, ticket), null, 'expired after the 10 minutes') } finally { Date.now = realNow }
    assert.equal(lib.DEVICE_TICKET_TTL_SECONDS, 600)
    const noKey = setup({ APP_ENCRYPTION_KEY: undefined })
    assert.equal(await noKey.lib.issueDeviceTicket(noKey.h.env, 10, 'ticket-device-0001'), null, 'no key, no ticket')
  })

  await check('a pending sign-in answers with a ticket; an approved one and an administrator do not get one', async () => {
    const { h, lib } = setup()
    const pending = await signIn(h, 'wait-device-0003')
    assert.equal(pending.body.deviceApprovalRequired, true)
    assert.match(pending.body.deviceTicket, /^10\.wait-device-0003\.\d+\.[A-Za-z0-9_-]{43}$/)
    decide(h, 'wait-device-0003', 'approved')
    const approved = await signInWithCookie(h, lib, 'wait-device-0003')
    assert.equal(approved.body.success, true)
    assert.equal('deviceTicket' in approved.body, false)
    const admin = await signIn(h, 'admin-device-0004', 'owner')
    assert.equal('deviceTicket' in admin.body, false)
  })

  await check('/device-status follows the admin decision and never issues a session', async () => {
    const { h } = setup()
    const { body: { deviceTicket } } = await signIn(h, 'poll-device-0005')
    for (const [value, expected] of [['pending', 'pending'], ['approved', 'approved'], ['rejected', 'rejected']]) {
      decide(h, 'poll-device-0005', value)
      const res = await status(h, deviceTicket)
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { status: expected }, 'a status and nothing else: no user, token or session')
      assert.equal(res.headers.getSetCookie().length, 0, 'no cookie of any kind')
    }
    h.raw.prepare(`DELETE FROM trusted_devices WHERE user_id = 10`).run({})
    assert.deepEqual((await status(h, deviceTicket)).body, { status: 'missing' }, 'a reset row stops the wait')
    for (const ticket of [undefined, null, 5, 'garbage', `${deviceTicket}x`]) {
      assert.deepEqual((await status(h, ticket)).body, { status: 'expired' })
    }
    assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n, 0, 'no session row was created')
    const route = read('routes/auth.ts')
    const block = route.slice(route.indexOf("app.post('/device-status'"), route.indexOf("app.post('/logout'"))
    assert.ok(block.length > 100 && !/createSession|setSessionCookie|issueOtpChallenge/.test(block), 'the status route cannot mint a session by construction')
    assert.match(route, /app\.use\('\/device-status', requireJsonSameOriginCredentialPost\)/, 'same-origin JSON only')
    assert.match(read('lib/requestBodyGuard.ts'), /'\/api\/auth\/device-status'/, 'body size guard covers it')
  })

  await check('D1 cost: the status endpoint is one rate-limit write plus one read (review L3)', async () => {
    const { h } = setup()
    const { body: { deviceTicket } } = await signIn(h, 'cost-device-0006')
    let calls = 0
    const original = h.db.prepare.bind(h.db)
    h.db.prepare = (sql) => {
      const stmt = original(sql)
      return new Proxy(stmt, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => { calls += 1; return target[key](...args) } : target[key]) })
    }
    try { await status(h, deviceTicket) } finally { h.db.prepare = original }
    assert.equal(calls, 2, 'one limiter statement and one status read')
    calls = 0
    h.db.prepare = (sql) => { calls += 1; return original(sql) }
    try { await status(h, 'garbage') } finally { h.db.prepare = original }
    assert.equal(calls, 0, 'a bad ticket costs no D1 call')
    console.log('     /device-status D1 statements: valid ticket 2 (was 1 before the limiter), bad ticket 0')
  })

  await check('the status endpoint is limited per ticket: 20 a minute, then 429 with retry-after; another ticket is unaffected (review L3)', async () => {
    const { h } = setup()
    const first = (await signIn(h, 'limit-device-0001')).body.deviceTicket
    const other = (await signIn(h, 'limit-device-0002')).body.deviceTicket
    for (let n = 0; n < 20; n++) assert.equal((await status(h, first)).status, 200, `call ${n + 1}`)
    const refused = await status(h, first)
    assert.equal(refused.status, 429)
    assert.equal(refused.body.code, 'device_status_rate_limited')
    assert.ok(refused.body.retryAfterSeconds > 0)
    assert.equal((await status(h, other)).status, 200, 'a different ticket has its own allowance')
    assert.equal((await status(h, 'garbage')).body.status, 'expired', 'a bad ticket never reaches the limiter')
  })

  await check('only a newly created pending row raises the admin alert, not a retry', async () => {
    const { h, lib, broadcasts } = setup()
    await signIn(h, 'alert-device-0007')
    assert.deepEqual(broadcasts, [{ channel: 'notifications', payload: { type: 'device_pending' } }])
    await signIn(h, 'alert-device-0007')
    await signIn(h, 'alert-device-0007')
    assert.equal(broadcasts.length, 1, 'retries stay quiet')
    await signIn(h, 'alert-device-0008')
    assert.equal(broadcasts.length, 2, 'a second new device is a new alert')
    decide(h, 'alert-device-0007', 'approved')
    await signInWithCookie(h, lib, 'alert-device-0007')
    assert.equal(broadcasts.length, 2, 'an approved sign-in is silent')
  })

  await check('the bell lists pending devices again: pending only, newest first, capped at 20, one read', async () => {
    const source = read('routes/notifications.ts')
    const sql = /const rows = await db\.prepare\(`([\s\S]*?)`\)\.all</.exec(source.slice(source.indexOf('async function buildDeviceApprovalSection')))?.[1]
    assert.ok(sql, 'the pending-device query is back in buildDeviceApprovalSection')
    assert.ok(!/const rows: Array<[^>]*> = \[\]/.test(source), 'the empty stub is gone')
    const { h } = setup()
    for (let n = 1; n <= 25; n++) {
      h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, requested_at) VALUES (10, @id, @id, 'pending', @at)`).run({ id: `bell-device-${String(n).padStart(2, '0')}`, at: `2026-11-12 08:${String(n).padStart(2, '0')}:00` })
    }
    h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'approved-device-1', 'approved'), (10, 'rejected-device-1', 'rejected')`).run({})
    const rows = h.raw.prepare(sql).all({})
    assert.equal(rows.length, 20)
    assert.equal(rows[0].device_name, 'bell-device-25', 'newest first')
    assert.ok(rows.every((row) => row.username === 'sokha' && /^bell-device/.test(row.device_name)), 'only pending rows, with the account name')
    const section = source.slice(source.indexOf('async function buildDeviceApprovalSection'), source.indexOf("kind: 'security_device_pending'"))
    assert.equal((section.match(/db\.prepare\(/g) || []).length, 2, 'the pending read plus the existing new-country read: one call added')
    assert.match(source, /if \(isAdminControlUser\(user\)\) tasks\.push\(buildDeviceApprovalSection\(c\.env\)\)/, 'admins only')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
  console.log('test-device-status-ticket-pure: all checks passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
