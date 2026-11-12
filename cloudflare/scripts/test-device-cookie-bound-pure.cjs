// Device id is not a secret (review M1, 12 Nov 2026): the verified cookie always wins over the body id, and a row whose browser
// has had its cookie (trusted_devices.cookie_bound_at, migration 0304) refuses its id when it arrives without that cookie:
// the sender becomes a new browser with a fresh pending id. Rows approved before the release have no cookie yet, so their first
// sign-in with the body id still passes and binds them. Drives the REAL routes/auth.ts, lib/deviceTrust.ts and lib/deviceCookie.ts;
// the mutants at the end must turn the named checks red.
//
// Run: node scripts/test-device-cookie-bound-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')
function loadTs(rel, overrides, mutate = (text) => text, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const text = mutate(fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n'), rel)
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return loadTs(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`, overrides, mutate, cache)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const UA = 'Mozilla/5.0 (iPhone) Safari'
const COOKIE = '__Host-bos_dev'
const VICTIM = 'victim-approved-device-01'
const OTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

function setup(mutate = (t) => t, envPatch = {}) {
  let deviceTrust = null
  let cookieLib = null
  const h = createAuthHarness({
    overrides: {
      '../lib/deviceCookie': new Proxy({}, { get: (_t, key) => cookieLib[key] }),
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  Object.assign(h.env, envPatch)
  const stubs = { './db': { getDb: () => h.db }, './audit': { audit: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async () => {} } }
  const cache = new Map()
  deviceTrust = loadTs('lib/deviceTrust.ts', stubs, mutate, cache)
  cookieLib = loadTs('lib/deviceCookie.ts', stubs, mutate, cache)
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES (1, 'admin', 'Administrator', '{"all":true}', 1), (2, 'cashier', 'Cashier', '{"pos":true}', 0)`).run({})
  h.addUser({ id: 10, username: 'sokha', name: 'Sokha', roleCode: 'cashier' })
  h.addUser({ id: 11, username: 'owner', name: 'Owner', roleCode: 'admin' })
  h.addUser({ id: 12, username: 'vanna', name: 'Vanna', roleCode: 'cashier', otpSecret: OTP_SECRET })
  h.addUser({ id: 13, username: 'dara', name: 'Dara', roleCode: 'cashier' })
  h.addUser({ id: 14, username: 'mia', name: 'Mia', roleCode: 'cashier' })
  // The real admin approve route, so approval is what an administrator's click does and not a hand-written UPDATE.
  const permissions = loadTs('lib/permissions.ts', {}, mutate, cache)
  const admin = { id: 11, username: 'owner', name: 'Owner', role_code: 'admin', role_permissions: '{"all":true}', permissions: '{}' }
  const devices = loadTs('routes/devices.ts', {
    '../lib/db': { getDb: () => h.db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', admin); return next() }, revokeSessionsForDevice: async () => 0, revokeUserSessions: async () => {} },
    '../lib/audit': { audit: async () => {} },
    '../lib/permissions': permissions,
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/deviceTrust': deviceTrust,
    '../index': {},
  }, mutate, cache).default
  const adminCall = async (pathname, body = {}) => {
    const res = await devices.request(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, h.env, { waitUntil() {}, passThroughOnException() {} })
    return { status: res.status, body: await res.json() }
  }
  return { h, cookieLib, adminCall }
}

const rows = (h) => h.raw.prepare('SELECT device_id, status, cookie_bound_at FROM trusted_devices WHERE user_id = 10 ORDER BY id').all({}).map((r) => ({ ...r }))
const approve = (h, deviceId) => h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status, decided_at) VALUES (10, @deviceId, 'approved', CURRENT_TIMESTAMP)").run({ deviceId })
async function signIn(w, { deviceId, cookieFor } = {}) {
  const headers = { 'User-Agent': UA }
  if (cookieFor) headers.Cookie = `${COOKIE}=${await w.cookieLib.signDeviceCookieValue(w.h.env, cookieFor)}`
  return w.h.request('/login', 'POST', { username: 'sokha', password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers })
}
// Every device Set-Cookie line of a response, as the raw cookie value a browser (or a person reading the headers) could replay.
const cookieValues = (res) => res.headers.getSetCookie().filter((l) => l.startsWith(`${COOKIE}=`)).map((l) => l.split(';')[0].slice(COOKIE.length + 1))
const idOfCookie = (value) => decodeURIComponent(value).split('.')[0]
// The device cookie id of a response, or null. A response carries at most one (review H1: the first of two used to be a valid
// cookie for the refused id and a "last line wins" reader hid it), so more than one is a failure here rather than a quiet pop().
const lastCookieId = (res) => {
  const values = cookieValues(res)
  assert.ok(values.length <= 1, `a response carries at most one device cookie, got ${values.map(idOfCookie)}`)
  return values.length ? idOfCookie(values[0]) : null
}
// Replay a raw cookie value (what a person copying the header gets) against /login with the given body id.
const replay = (w, value, deviceId) => w.h.request('/login', 'POST', { username: 'sokha', password: 'correct-horse', deviceId, deviceName: 'Phone' }, { ip: '203.0.113.5', headers: { 'User-Agent': UA, Cookie: `${COOKIE}=${value}` } })

// One browser: it keeps the device cookie the server last set and the device id its page last stored (what Login.tsx does), and signs in as any account.
function browser(w, storedId) {
  const b = { jar: null, stored: storedId, last: null }
  b.go = async (username) => {
    const headers = { 'User-Agent': UA }
    if (b.jar) headers.Cookie = `${COOKIE}=${b.jar}`
    const res = await w.h.request('/login', 'POST', { username, password: 'correct-horse', deviceId: b.stored, deviceName: 'Phone' }, { ip: '203.0.113.5', headers })
    const values = cookieValues(res)
    assert.ok(values.length <= 1, 'at most one device cookie')
    if (values.length) b.jar = values[0]
    if (res.body.deviceId) b.stored = res.body.deviceId
    b.last = res
    return res
  }
  return b
}
const userRows = (h, userId) => h.raw.prepare('SELECT id, device_id, status, cookie_bound_at IS NOT NULL AS bound, claimed_approval_ref FROM trusted_devices WHERE user_id = @userId ORDER BY id').all({ userId }).map((r) => ({ ...r }))
const approveRow = async (w, userId) => { const r = await w.adminCall(`/${userRows(w.h, userId)[0].id}/approve`, { confirmShared: true }); assert.equal(r.status, 200, JSON.stringify(r.body)) }
const legacyApproved = (h, userId, deviceId) => h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status, decided_at) VALUES (@userId, @deviceId, 'approved', CURRENT_TIMESTAMP)").run({ userId, deviceId })

const SESSION = 'live-session-token-0001'
const addSession = (h, userId, deviceId, { revoked = false } = {}) => h.raw.prepare(`INSERT INTO user_sessions (user_id, token_hash, device_id, expires_at, revoked_at)
  VALUES (@userId, @hash, @deviceId, '2999-01-01', CASE WHEN @revoked = 1 THEN CURRENT_TIMESTAMP END)`).run({ userId, deviceId, revoked: revoked ? 1 : 0, hash: createHash('sha256').update(SESSION).digest('hex') })
async function me(w, { actorId = 10, cookieFor, path: route = '/me' } = {}) {
  const headers = { 'User-Agent': UA, Cookie: `bos_session=${SESSION}` }
  if (cookieFor) headers.Cookie += `; ${COOKIE}=${await w.cookieLib.signDeviceCookieValue(w.h.env, cookieFor)}`
  const statements = []
  const prepare = w.h.db.prepare.bind(w.h.db)
  w.h.db.prepare = (sql) => { statements.push(sql); return prepare(sql) }
  try {
    const res = await w.h.request(route, 'GET', undefined, { actorId, headers })
    return { res, statements }
  } finally { w.h.db.prepare = prepare }
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`.slice(0, 400))
  }
}

async function suite(mutate, label) {
  failures.length = 0
  passed = 0
  console.log(`\n== ${label}`)

  await check('a. transition: an approved row with no cookie yet signs in with its body id once, gets the cookie, and is bound', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    assert.equal(rows(w.h)[0].cookie_bound_at, null)
    const res = await signIn(w, { deviceId: VICTIM })
    assert.equal(res.body.success, true)
    assert.equal(lastCookieId(res), VICTIM)
    assert.ok(rows(w.h)[0].cookie_bound_at, 'bound by that sign-in')
  })

  await check('b. after binding, the same id in a body with no cookie gets a fresh pending id; the approved row is untouched', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    await signIn(w, { deviceId: VICTIM })
    const attack = await signIn(w, { deviceId: VICTIM })
    assert.equal(attack.body.deviceApprovalRequired, true)
    assert.notEqual(attack.body.deviceId, VICTIM, 'told to adopt a new id')
    assert.equal(lastCookieId(attack), attack.body.deviceId, 'the cookie is pinned to the new id, not the victim id')
    assert.ok(attack.body.deviceTicket, 'a ticket for the new id so the waiting screen works')
    const approvedRowId = w.h.raw.prepare('SELECT id FROM trusted_devices WHERE device_id = @d').get({ d: VICTIM }).id
    assert.equal(w.h.raw.prepare('SELECT claimed_approval_ref AS c FROM trusted_devices WHERE device_id = @d').get({ d: attack.body.deviceId }).c, approvedRowId, 'the pending row records which approved device it claimed (L4)')
    const pendingAudit = w.h.audits.filter((a) => a[3] === 'login_device_pending').pop()
    assert.equal(pendingAudit[6].claimedTrustedDeviceRowId, approvedRowId, 'and so does its audit row')
    const state = rows(w.h)
    assert.equal(state.find((r) => r.device_id === VICTIM).status, 'approved')
    assert.deepEqual(state.filter((r) => r.device_id !== VICTIM).map((r) => r.status), ['pending'])
    const retry = await signIn(w, { deviceId: attack.body.deviceId, cookieFor: attack.body.deviceId })
    assert.equal(retry.body.deviceApprovalRequired, true)
    assert.equal(rows(w.h).length, 2, 'the retry reuses the new pending row')
  })

  await check('c. review probe: the attacker\'s own pending cookie plus the victim approved id in the body is still pending (cookie wins)', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    const first = await signIn(w, { deviceId: 'attacker-own-device-1' })
    assert.equal(first.body.deviceApprovalRequired, true)
    const probe = await signIn(w, { deviceId: VICTIM, cookieFor: 'attacker-own-device-1' })
    assert.equal(probe.body.deviceApprovalRequired, true)
    assert.equal(probe.body.deviceId, 'attacker-own-device-1')
  })

  await check('d. the genuine browser (cookie and body agree) keeps signing in', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    await signIn(w, { deviceId: VICTIM })
    for (let n = 0; n < 2; n++) assert.equal((await signIn(w, { deviceId: VICTIM, cookieFor: VICTIM })).body.success, true)
    assert.equal((await signIn(w, { deviceId: 'stale-local-id-0001', cookieFor: VICTIM })).body.success, true, 'a stale body id is ignored when the cookie is right')
  })

  await check('e. a first pending sign-in also binds, so approving it later gives a bound row', async () => {
    const w = setup(mutate)
    const first = await signIn(w, { deviceId: 'new-browser-device-1' })
    assert.equal(first.body.deviceApprovalRequired, true)
    assert.ok(rows(w.h)[0].cookie_bound_at)
    w.h.raw.prepare("UPDATE trusted_devices SET status = 'approved'").run({})
    assert.equal((await signIn(w, { deviceId: 'new-browser-device-1' })).body.deviceApprovalRequired, true, 'its id without its cookie is refused')
    assert.equal((await signIn(w, { deviceId: 'new-browser-device-1', cookieFor: 'new-browser-device-1' })).body.success, true)
  })

  await check('f. with no signing key (no cookies exist) nothing is bound and the body id still works', async () => {
    const w = setup(mutate, { APP_ENCRYPTION_KEY: undefined })
    approve(w.h, VICTIM)
    assert.equal((await signIn(w, { deviceId: VICTIM })).body.success, true)
    assert.equal(rows(w.h)[0].cookie_bound_at, null)
    assert.equal((await signIn(w, { deviceId: VICTIM })).body.success, true)
  })

  await check('g. a long session that never passes /login again is bound and given the cookie on /me and /bootstrap (L3), and then the id alone no longer works', async () => {
    const routeText = fs.readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8')
    assert.equal(routeText.split('if (requiresDeviceApproval(user)) await adoptSessionDeviceCookie(c, user.id)').length - 1, 2, '/me and /bootstrap both adopt (the harness stubs the session layer /bootstrap needs, so it is pinned by source)')
    for (const route of ['/me']) {
      const w = setup(mutate)
      approve(w.h, VICTIM)
      addSession(w.h, 10, VICTIM)
      const { res } = await me(w, { path: route })
      assert.equal(res.status, 200, `${route} answered ${res.status}`)
      assert.equal(lastCookieId(res), VICTIM, `${route} set the cookie`)
      assert.ok(rows(w.h)[0].cookie_bound_at, `${route} bound the row`)
      const attack = await signIn(w, { deviceId: VICTIM })
      assert.equal(attack.body.deviceApprovalRequired, true, 'the id without its cookie is refused from now on')
    }
  })

  await check('h. the ordinary request costs no D1 call; only a browser without the cookie costs one UPDATE; a bound row, a revoked session, an admin, another account never bind', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    addSession(w.h, 10, VICTIM)
    const withCookie = await me(w, { cookieFor: VICTIM })
    assert.equal(withCookie.statements.length, 0, 'a valid cookie: no statement at all')
    assert.equal(rows(w.h)[0].cookie_bound_at, null, 'and nothing is bound by it')
    const bare = await me(w)
    assert.equal(bare.statements.length, 1, 'no cookie: one UPDATE ... RETURNING')
    assert.equal(lastCookieId(bare.res), VICTIM)
    const again = await me(w)
    assert.equal(again.statements.length, 1)
    assert.equal(lastCookieId(again.res), null, 'a bound row is not re-issued its cookie from a session')
    const w2 = setup(mutate)
    approve(w2.h, VICTIM)
    addSession(w2.h, 10, VICTIM, { revoked: true })
    assert.equal(lastCookieId((await me(w2)).res), null, 'a revoked session proves nothing')
    assert.equal(rows(w2.h)[0].cookie_bound_at, null)
    const w3 = setup(mutate)
    approve(w3.h, VICTIM)
    addSession(w3.h, 11, VICTIM)
    const admin = await me(w3, { actorId: 11 })
    assert.equal(admin.statements.length, 0, 'administrators have no device gate and cost nothing')
    assert.equal(rows(w3.h)[0].cookie_bound_at, null, "an administrator's session never binds a row")
    // L-5: the discriminating case is a NON-admin second account. Her session names the id, the row belongs to Sokha: the UPDATE runs (she has no cookie) and must match nothing.
    const w4 = setup(mutate)
    approve(w4.h, VICTIM)
    addSession(w4.h, 12, VICTIM)
    const other = await me(w4, { actorId: 12 })
    assert.equal(other.statements.length, 1, 'a non-admin without the cookie reaches the UPDATE')
    assert.equal(rows(w4.h)[0].cookie_bound_at, null, "another account's row is never bound by her session")
    assert.equal(lastCookieId(other.res), null, 'and she is not given a cookie for it')
  })

  await check('j. H1 (/login): a refused body-only sign-in emits no cookie for the refused id: every Set-Cookie is the one fresh id, and replaying each of them signs nobody in', async () => {
    const w = setup(mutate)
    approve(w.h, VICTIM)
    await signIn(w, { deviceId: VICTIM }) // binds the row
    const sessionsBefore = w.h.raw.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n
    const attack = await signIn(w, { deviceId: VICTIM })
    assert.equal(attack.body.deviceApprovalRequired, true)
    const values = cookieValues(attack)
    assert.deepEqual(values.map(idOfCookie), [attack.body.deviceId], 'exactly one device cookie, for the fresh id only')
    assert.ok(!values.some((v) => idOfCookie(v) === VICTIM), 'no cookie names the refused id')
    for (const value of values) for (const body of [VICTIM, attack.body.deviceId, undefined]) {
      const again = await replay(w, value, body)
      assert.equal(again.body.success, undefined, 'replaying an emitted cookie does not sign in')
      assert.equal(again.body.deviceApprovalRequired, true)
    }
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n, sessionsBefore, 'no session was issued to the attacker')
  })

  await check('k. H1 (/otp/verify): the same on the authenticator step, with a challenge from a genuine first step', async () => {
    const w = setup(mutate)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status, decided_at) VALUES (12, @d, 'approved', CURRENT_TIMESTAMP)").run({ d: VICTIM })
    const login = (cookieFor) => w.h.request('/login', 'POST', { username: 'vanna', password: 'correct-horse', deviceId: VICTIM, deviceName: 'Phone' }, { ip: '203.0.113.5', headers: { 'User-Agent': UA, ...(cookieFor ? { Cookie: `${COOKIE}=${cookieFor}` } : {}) } })
    const genuine = await login(null)
    assert.equal(genuine.body.otpRequired, true, 'the genuine first step passes the gate and binds the row')
    const own = cookieValues(genuine)[0]
    assert.equal(idOfCookie(own), VICTIM)
    const challenge = (await login(own)).body.otpChallenge
    assert.ok(challenge)
    const verify = async (value) => w.h.request('/otp/verify', 'POST', { userId: 12, token: await w.h.codeAt(OTP_SECRET), otpChallenge: challenge, deviceId: VICTIM, deviceName: 'Phone' }, { ip: '203.0.113.5', headers: { 'User-Agent': UA, ...(value ? { Cookie: `${COOKIE}=${value}` } : {}) } })
    const attack = await verify(null)
    assert.equal(attack.body.deviceApprovalRequired, true, JSON.stringify(attack.body))
    const values = cookieValues(attack)
    assert.deepEqual(values.map(idOfCookie), [attack.body.deviceId])
    assert.notEqual(attack.body.deviceId, VICTIM)
    for (const value of values) {
      const second = await login(value)
      assert.equal(second.body.otpRequired, undefined, 'the emitted cookie does not pass the first step either')
      assert.equal(second.body.deviceApprovalRequired, true)
    }
  })

  await check('l. H1 (every path): the cookie helper sets a cookie only for an accepted or freshly created id; /oauth/callback calls it after the gate, like /login and /otp/verify', async () => {
    const w = setup(mutate)
    const answer = async (deviceId, trust, { verified = false } = {}) => {
      const app = new Hono()
      app.get('/', async (c) => {
        await w.cookieLib.resolveDeviceId(c, 10, deviceId)
        const id = await w.cookieLib.pinDeviceAfterGate(c, deviceId, trust)
        return c.json({ id })
      })
      const headers = verified ? { Cookie: `${COOKIE}=${await w.cookieLib.signDeviceCookieValue(w.h.env, deviceId)}` } : {}
      const res = await app.request('/', { headers }, w.h.env)
      return { id: (await res.json()).id, ids: cookieValues(res).map(idOfCookie) }
    }
    assert.deepEqual((await answer('refused-id-0001', { status: 'rejected' })).ids, [], 'rejected: nothing')
    assert.deepEqual((await answer('refused-id-0001', { status: 'rejected' }, { verified: true })).ids, [], 'rejected with its own cookie: nothing')
    assert.deepEqual((await answer('refused-id-0001', { status: 'missing_device_id' })).ids, [])
    assert.deepEqual((await answer('refused-id-0001', { status: 'pending', created: false })).ids, [], 'an existing pending row named only by a body id')
    assert.deepEqual((await answer('refused-id-0001', { status: 'pending', created: true, heldByOther: true })).ids, [], 'an id another account holds, sent without its cookie')
    assert.deepEqual((await answer('new-pending-0001', { status: 'pending', created: true })).ids, ['new-pending-0001'], 'a pending row this request created')
    assert.deepEqual((await answer('own-pending-0001', { status: 'pending', created: false }, { verified: true })).ids, ['own-pending-0001'], 'a verified cookie is renewed')
    assert.deepEqual((await answer('ok-device-0001', { status: 'approved' })).ids, ['ok-device-0001'])
    const fresh = await answer('victim-id-0001', { status: 'pending', created: true, replacedDeviceId: 'fresh-id-00001' })
    assert.deepEqual([fresh.id, fresh.ids], ['fresh-id-00001', ['fresh-id-00001']], 'the fresh id, never the refused one')
    const auth = fs.readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8').replace(/\r\n/g, '\n')
    const callback = auth.slice(auth.indexOf("app.get('/oauth/callback'"), auth.indexOf("app.post('/oauth/complete'"))
    assert.ok(callback.indexOf('checkDeviceTrust(') < callback.indexOf('pinDeviceAfterGate('), '/oauth/callback pins after the gate (the Google redirect cannot be driven through the harness, so this path is pinned by the shared helper above and by this order check)')
    assert.ok(!callback.includes('pinDeviceCookie('))
  })

  await check('m. N-1: a shared browser with no cookie yet (deploy day): the new employee is approved once and then signs in; nobody on the browser is asked again', async () => {
    const w = setup(mutate)
    const SHARED = 'shared-till-device-01'
    legacyApproved(w.h, 10, SHARED)
    const b = browser(w, SHARED)
    const first = await b.go('dara')
    assert.equal(first.body.deviceApprovalRequired, true, 'a new employee on the shared browser is pending')
    assert.equal(b.jar, null, 'no cookie is set for an id another account holds')
    assert.equal(userRows(w.h, 13)[0].bound, 0, 'so her row is not marked as cookie-bound: there is no cookie to prove')
    await approveRow(w, 13)
    const second = await b.go('dara')
    assert.equal(second.body.success, true, JSON.stringify(second.body))
    assert.equal(userRows(w.h, 13).length, 1, 'no second pending row for dara')
    assert.equal(userRows(w.h, 13)[0].claimed_approval_ref, null, 'and no false "could not prove it" claim')
    const sokha = await b.go('sokha')
    assert.equal(sokha.body.success, true, 'sokha is not asked again')
    assert.equal(userRows(w.h, 10).length, 1)
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE claimed_approval_ref IS NOT NULL').get({}).n, 0)
  })

  await check('n. N-1 (deploy day, three employees): two new employees both wait on the cookie-less shared browser; approving both signs everybody in, with no cascade of re-asks', async () => {
    const w = setup(mutate)
    const SHARED = 'shared-till-device-02'
    legacyApproved(w.h, 10, SHARED)
    const b = browser(w, SHARED)
    assert.equal((await b.go('dara')).body.deviceApprovalRequired, true)
    assert.equal((await b.go('mia')).body.deviceApprovalRequired, true)
    await approveRow(w, 13)
    await approveRow(w, 14)
    for (const who of ['dara', 'mia', 'sokha', 'dara', 'mia']) {
      const res = await b.go(who)
      assert.equal(res.body.success, true, `${who}: ${JSON.stringify(res.body)}`)
    }
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get({}).n, 3, 'one row per employee, no extra pending rows')
    // positive control: once a cookie really exists for the id, a cookie-less body id from another browser is still refused.
    const attacker = browser(w, SHARED)
    const refused = await attacker.go('dara')
    assert.equal(refused.body.success, undefined, 'a body-only sign-in on a bound id is still refused')
  })

  await check('o. N-4: another non-admin account sending the victim id with no cookie gets pending, no cookie for it, and a replay signs nobody in', async () => {
    const w = setup(mutate)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status, decided_at, cookie_bound_at) VALUES (10, @d, 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run({ d: VICTIM })
    const attacker = browser(w, VICTIM)
    const res = await attacker.go('dara')
    assert.equal(res.body.deviceApprovalRequired, true)
    assert.equal(attacker.jar, null, 'no cookie is minted for the id sokha holds')
    const sessionsBefore = w.h.raw.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n
    for (const user of ['dara', 'sokha']) {
      const again = await attacker.go(user)
      assert.equal(again.body.success, undefined, `${user} is not signed in with the attacker's browser state`)
    }
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n, sessionsBefore, 'no session issued')
  })

  await check('p. P-1 HB: a request created while a colleague\'s id was unbound never mints the colleague\'s cookie once the colleague has bound, even after the administrator approves it', async () => {
    const w = setup(mutate)
    const V2 = 'colleague-phone-device-01'
    legacyApproved(w.h, 13, V2)
    const attacker = browser(w, V2)
    assert.equal((await attacker.go('sokha')).body.deviceApprovalRequired, true, 'her own password and the colleague id: pending')
    assert.equal(userRows(w.h, 10)[0].bound, 0, 'inserted while the id was unbound')
    const victim = browser(w, V2)
    assert.equal((await victim.go('dara')).body.success, true, 'the colleague signs in on her phone and binds')
    assert.equal(userRows(w.h, 13)[0].bound, 1)
    await approveRow(w, 10)
    const again = await attacker.go('sokha')
    assert.equal(again.body.success, undefined, 'approved, but without the cookie of a bound id she is a new browser: ' + JSON.stringify(again.body).slice(0, 120))
    assert.ok(!attacker.jar || idOfCookie(attacker.jar) !== V2, 'no cookie for the colleague id')
    const replayAsVictim = await attacker.go('dara')
    assert.equal(replayAsVictim.body.success, undefined, 'and nothing she holds signs in as the colleague')
  })

  await check('q. L-1 (release review HF): a long session of an account whose approved row on an id is unbound does not get the cookie for that id once another account has bound it; the first-bound account still adopts', async () => {
    const w = setup(mutate)
    const V2 = 'colleague-phone-device-02'
    legacyApproved(w.h, 13, V2)
    legacyApproved(w.h, 10, V2)
    addSession(w.h, 10, V2)
    const victim = browser(w, V2)
    assert.equal((await victim.go('dara')).body.success, true, 'the colleague signs in on her phone and binds')
    assert.equal(userRows(w.h, 13)[0].bound, 1)
    const { res } = await me(w)
    assert.equal(res.status, 200)
    assert.deepEqual(cookieValues(res), [], 'no cookie for an id another account holds')
    assert.equal(userRows(w.h, 10)[0].bound, 0, 'the row stays unbound')
    const replay = await signIn(w, { deviceId: V2 })
    assert.equal(replay.body.success, undefined, 'the id alone signs nobody in')
    const w2 = setup(mutate)
    legacyApproved(w2.h, 10, V2)
    addSession(w2.h, 10, V2)
    const alone = await me(w2)
    assert.equal(lastCookieId(alone.res), V2, 'control: with nobody else bound the session still adopts')
  })

  await check('i. the session cookie name used by the helper is the one lib/auth.ts sets', () => {
    const auth = fs.readFileSync(path.join(SRC, 'lib/auth.ts'), 'utf8')
    const cookie = fs.readFileSync(path.join(SRC, 'lib/deviceCookie.ts'), 'utf8')
    assert.equal(/const SESSION_COOKIE_NAME = '([^']+)'/.exec(auth)[1], /const SESSION_COOKIE_NAME = '([^']+)'/.exec(cookie)[1])
  })

  console.log(`   ${passed} passed, ${failures.length} failed`)
  return [...failures]
}

const inFile = (file, from, to) => (text, rel) => (rel === file ? text.replace(from, to) : text)
const mutants = [
  ['bound rows no longer refuse a cookie-less id', inFile('lib/deviceTrust.ts', '(existing.cookie_bound_at || found?.held_bound_by_other) && !meta.cookieVerified', 'false'), ['b.', 'e.']],
  ['an id taken from the body is pinned before the gate again (H1)', inFile('lib/deviceCookie.ts', 'if (chosen && chosen === cookieId) cookieVerifiedIds.set(c, chosen)', 'if (chosen) await pinDeviceCookie(c, chosen)\n  if (chosen && chosen === cookieId) cookieVerifiedIds.set(c, chosen)'), ['j.', 'k.']],
  ['the post-gate pin accepts every answer', inFile('lib/deviceCookie.ts', "const accept = trust.status === 'approved'", "const accept = true || trust.status === 'approved'"), ['l.']],
  ['the body id wins over the cookie again', inFile('lib/deviceCookie.ts', 'const chosen = cookieId || body', 'const chosen = body || cookieId'), ['c.']],
  ['the session never binds an unbound row', inFile('lib/deviceCookie.ts', 'const token = getCookie(c, SESSION_COOKIE_NAME)', 'const token = null as string | null'), ['g.', 'h.']],
  ['a session binds the row of another account (user_id predicate dropped)', inFile('lib/deviceCookie.ts', "WHERE user_id = @user_id AND status = 'approved' AND cookie_bound_at IS NULL", "WHERE status = 'approved' AND cookie_bound_at IS NULL"), ['h.']],
  ['a bound row is re-issued its cookie by a session', inFile('lib/deviceCookie.ts', ' AND cookie_bound_at IS NULL', ''), ['h.']],
  ['binding never happens', inFile('lib/deviceTrust.ts', "cookie_bound_at = COALESCE(cookie_bound_at, CASE WHEN @bind = 1 THEN CURRENT_TIMESTAMP END)", 'cookie_bound_at = cookie_bound_at'), ['a.']],
  ['a new pending row is marked cookie-bound even when no cookie was set (N-1)', inFile('lib/deviceTrust.ts', 'bind: willBind ? 1 : 0,', 'bind: cookiesOn ? 1 : 0,'), ['m.', 'n.']],
  ['the held-by-another-account answer is dropped (N-4)', inFile('lib/deviceTrust.ts', '...(found?.held_by_other ? { heldByOther: true } : {})', ''), ['o.']],
  ['a session adopts an id another account has bound (L-1, probe HF)', inFile('lib/deviceCookie.ts', 'o.user_id <> trusted_devices.user_id', 'o.user_id = trusted_devices.user_id'), ['q.']],
  ['an approved but unbound row skips the fresh id although a colleague has bound the id (P-1 HB)', inFile('lib/deviceTrust.ts', '(existing.cookie_bound_at || found?.held_bound_by_other) && !meta.cookieVerified', 'existing.cookie_bound_at && !meta.cookieVerified'), ['p.']],
]

async function main() {
  const base = await suite((t) => t, 'real code')
  let bad = base.length
  for (const [name, mutate, expectRed] of mutants) {
    const red = await suite(mutate, `mutant: ${name}`)
    const missing = expectRed.filter((prefix) => !red.some((n) => n.startsWith(prefix)))
    if (missing.length) { console.log(`MUTANT SURVIVED: ${name}; ${missing.join(', ')} stayed green`); bad += 1 } else console.log(`mutant killed: ${name} (red: ${red.map((n) => n.split('.')[0]).join(', ')})`)
  }
  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-device-cookie-bound-pure: all checks passed and every mutant was killed')
}
main().catch((error) => { console.error(error); process.exit(1) })
