// Shop devices (owner 12 Nov 2026): an administrator marks a till once and every active employee signs in there
// without a separate approval or a device slot. Drives the REAL routes/auth.ts (harness, every migration applied),
// routes/devices.ts, lib/deviceTrust.ts, lib/deviceCookie.ts and lib/permissions.ts. The mutants at the end each
// break one rule and must turn the named checks red, proving the assertions bite.
//
// Run: node scripts/test-shop-device-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')

function loadTs(rel, overrides, mutate = (text) => text, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const text = mutate(fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n'), rel)
  const output = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
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

const UA = 'Mozilla/5.0 (Linux; Android 14) Chrome'
const COOKIE = '__Host-bos_dev'
const TILL = 'till-one-device-0001'
const ctx = { waitUntil() {}, passThroughOnException() {} }
const ADMIN = { id: 11, username: 'owner', name: 'Owner', role_code: 'admin', role_permissions: '{"all":true}', permissions: '{}' }
const CASHIER = { id: 12, username: 'dara', name: 'Dara', role_code: 'cashier', role_permissions: '{"pos":true}', permissions: '{}' }

function setup(mutate = (text) => text) {
  let deviceTrust = null
  let authLib = null
  const tokens = []
  let routeActor = null
  const h = createAuthHarness({
    mutate,
    overrides: {
      '../lib/auth': {
        createSession: async (...args) => { const made = await authLib.createSession(...args); tokens.push(made.token); return made },
        // /session-duration runs for real (check 10): the lib/auth functions it calls are the real ones, the actor is whoever routeActor names.
        currentSessionReissueSource: (...args) => authLib.currentSessionReissueSource(...args),
        reissueSession: async (...args) => { const made = await authLib.reissueSession(...args); if (made) tokens.push(made.token); return made },
        lengthensSession: (...args) => authLib.lengthensSession(...args),
        resolveSessionDuration: (...args) => authLib.resolveSessionDuration(...args),
        hasSessionCookie: () => false,
        setSessionCookie: () => {},
        clearSessionCookie: () => {},
        getSessionUser: async () => null,
        revokeSession: async () => {},
        revokeUserSessions: async () => {},
        requireAuth: async (c, next) => { if (routeActor) c.set('user', { id: routeActor, username: 'dara', name: 'Dara', role_code: 'cashier', role_permissions: '{"pos":true}', permissions: '{}' }); return next() },
      },
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  const trustAudits = []
  const stubs = { './db': { getDb: () => h.db }, './audit': { audit: async (...args) => { trustAudits.push({ action: args[3], details: args[6] }) } }, '../durable-objects/broadcastHub': { broadcast: async () => {} } }
  authLib = loadTs('lib/auth.ts', { './planTier': loadTs('lib/planTier.ts', {}), './db': { getDb: () => h.db }, '../index': {} }, mutate)
  deviceTrust = loadTs('lib/deviceTrust.ts', stubs, mutate)
  const cookieLib = loadTs('lib/deviceCookie.ts', stubs)
  const permissions = loadTs('lib/permissions.ts', {})
  const audits = []
  let current = ADMIN
  const devices = loadTs('routes/devices.ts', {
    '../lib/db': { getDb: () => h.db },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', current); return next() }, revokeSessionsForDevice: async () => 0, revokeUserSessions: async () => {} },
    '../lib/audit': { audit: async (...args) => { audits.push([args[3], args[4], args[5], args[6]]) } },
    '../lib/permissions': permissions,
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/deviceTrust': deviceTrust,
    '../index': {},
  }, mutate).default
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES
    (1, 'admin', 'Administrator', '{"all":true}', 1),
    (2, 'cashier', 'Cashier', '{"pos":true,"sales":true}', 0)`).run({})
  h.addUser({ id: 10, username: 'sokha', name: 'Sokha', roleCode: 'cashier' })
  h.addUser({ id: 12, username: 'dara', name: 'Dara', roleCode: 'cashier' })
  h.addUser({ id: 11, username: 'owner', name: 'Owner', roleCode: 'admin' })
  const as = (user) => { current = user }
  const call = async (pathname, method = 'POST', body) => {
    const res = await devices.request(pathname, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, h.env, ctx)
    return { status: res.status, body: await res.json() }
  }
  return { h, cookieLib, audits, trustAudits, as, call, authLib, tokens, actAs: (id) => { routeActor = id } }
}

const trusted = (h, userId) => h.raw.prepare('SELECT device_id, status FROM trusted_devices WHERE user_id = @userId ORDER BY id').all({ userId }).map((r) => ({ ...r }))
const approve = (h, deviceId, userId = 10) => h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at)
  VALUES (@userId, @deviceId, 'Till tablet', 'approved', CURRENT_TIMESTAMP)`).run({ userId, deviceId })
const rowId = (h, userId, deviceId) => h.raw.prepare('SELECT id FROM trusted_devices WHERE user_id = @userId AND device_id = @deviceId').get({ userId, deviceId }).id
const sessionsOf = (h) => h.raw.prepare('SELECT id, user_id, device_id, shop_device_id, revoked_at FROM user_sessions ORDER BY id').all({}).map((r) => ({ ...r }))
const deviceCookies = (res) => res.headers.getSetCookie().filter((l) => l.startsWith(`${COOKIE}=`)).map((l) => l.split(';')[0].slice(COOKIE.length + 1))
const cookieIdOf = (value) => decodeURIComponent(value).split('.')[0]
const live = (h) => sessionsOf(h).filter((s) => !s.revoked_at).map((s) => s.id)

async function markTill(world, deviceId = TILL, label = 'Till 1') {
  approve(world.h, deviceId, 10)
  const res = await world.call(`/${rowId(world.h, 10, deviceId)}/mark-shop`, 'POST', { label })
  assert.equal(res.status, 200, JSON.stringify(res.body))
}

async function signIn(world, { username = 'dara', deviceId, cookieFor, cookie, country, ip = '203.0.113.5' } = {}) {
  const headers = { 'User-Agent': UA }
  if (country) headers['cf-ipcountry'] = country
  const value = cookie || (cookieFor ? await world.cookieLib.signDeviceCookieValue(world.h.env, cookieFor) : null)
  if (value) headers.Cookie = `${COOKIE}=${value}`
  return world.h.request('/login', 'POST', { username, password: 'correct-horse', deviceId, deviceName: 'Tablet' }, { ip, headers })
}

// What POST /session-duration does with a session cookie: lib/auth.ts reads the source row, then re-issues in one batch.
async function reissueFrom(world, token, userId = 12) {
  const c = { env: world.h.env, req: { raw: new Request('http://localhost/session-duration', { headers: { Cookie: `bos_session=${token}` } }), header: () => undefined } }
  const source = await world.authLib.currentSessionReissueSource(c)
  assert.ok(source, 'the session row is found')
  const made = await world.authLib.reissueSession(c, userId, { sessionDuration: 'always', deviceId: source.deviceId, shopDeviceId: source.shopDeviceId, limitFamilyId: source.limitFamilyId })
  assert.ok(made, 'a new session was issued')
  return made.token
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
    const detail = error && 'actual' in error ? ` actual=${JSON.stringify(error.actual)} expected=${JSON.stringify(error.expected)}` : ''
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}${detail}`.slice(0, 600))
  }
}

const countStatements = async (h, run) => {
  let calls = 0
  const original = h.db.prepare.bind(h.db)
  h.db.prepare = (sql) => {
    const stmt = original(sql)
    return new Proxy(stmt, { get: (target, key) => (typeof target[key] === 'function' ? (...args) => { calls += 1; return target[key](...args) } : target[key]) })
  }
  try { await run() } finally { h.db.prepare = original }
  return calls
}

async function suite(mutate, label) {
  failures.length = 0
  passed = 0
  console.log(`\n== ${label}`)

  await check('1. a marked device with its verified cookie: an employee signs in with no pending row and no slot, the session is tagged', async () => {
    const w = setup(mutate)
    await markTill(w)
    const res = await signIn(w, { deviceId: TILL, cookieFor: TILL })
    assert.equal(res.status, 200)
    assert.equal(res.body.success, true)
    assert.deepEqual(trusted(w.h, 12), [], 'the employee gets no trusted_devices row at all')
    const shopId = w.h.raw.prepare('SELECT id FROM shop_devices WHERE device_id = @d AND unmarked_at IS NULL').get({ d: TILL }).id
    assert.deepEqual(sessionsOf(w.h).map((s) => [s.user_id, s.shop_device_id]), [[12, shopId]])
  })

  await check('1b. a second employee also signs in there; and an employee already at the 5-device cap still does, using no slot', async () => {
    const w = setup(mutate)
    await markTill(w)
    for (let n = 1; n <= 5; n++) approve(w.h, `own-device-000${n}`, 12)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.success, true)
    assert.equal((await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })).body.success, true)
    assert.equal(trusted(w.h, 12).filter((r) => r.status === 'approved').length, 5)
    assert.equal(trusted(w.h, 12).length, 5, 'no sixth row')
  })

  await check('2. the body id alone (no cookie, bad cookie, another device cookie) never unlocks the shop path: normal approval applies', async () => {
    const w = setup(mutate)
    await markTill(w)
    const noCookie = await signIn(w, { deviceId: TILL })
    assert.equal(noCookie.body.deviceApprovalRequired, true)
    assert.equal(noCookie.body.success, undefined)
    const forged = await signIn(w, { deviceId: TILL, cookie: `${TILL}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` })
    assert.equal(forged.body.deviceApprovalRequired, true)
    const otherCookie = await signIn(w, { deviceId: TILL, cookieFor: 'some-other-device-9' })
    assert.equal(otherCookie.body.deviceApprovalRequired, true)
    assert.equal(sessionsOf(w.h).length, 0, 'no session was issued')
    assert.ok(trusted(w.h, 12).length >= 1 && trusted(w.h, 12).every((r) => r.status === 'pending'), 'only pending rows, for an admin to decide')
    assert.ok(trusted(w.h, 12).every((r) => r.device_id !== TILL), "none of them on the till's own id (M-1): each is a fresh id")
    for (const res of [noCookie, forged, otherCookie]) assert.ok(deviceCookies(res).every((v) => cookieIdOf(v) !== TILL), 'no cookie for the till id is emitted (H1)')
  })

  await check('2a. H1 on a marked till: a body-only sign-in emits at most one device cookie, never the till id, and replaying each signs nobody in', async () => {
    const w = setup(mutate)
    await markTill(w)
    const attempt = await signIn(w, { deviceId: TILL })
    assert.equal(attempt.body.deviceApprovalRequired, true)
    const values = deviceCookies(attempt)
    assert.deepEqual(values.map(cookieIdOf), [attempt.body.deviceId], 'one cookie, for the fresh id')
    assert.notEqual(attempt.body.deviceId, TILL)
    for (const value of values) for (const body of [TILL, attempt.body.deviceId, undefined]) {
      const again = await signIn(w, { deviceId: body, cookie: value })
      assert.equal(again.body.success, undefined, 'the emitted cookie is no key to the till')
      assert.equal(again.body.deviceApprovalRequired, true)
    }
    assert.equal(sessionsOf(w.h).length, 0)
  })

  await check('2c. M-1: a cookie-less sign-in on a marked till never creates a row on the till id, so no stale request can be declined onto the till or survive an unmark', async () => {
    const w = setup(mutate)
    await markTill(w)
    const lost = await signIn(w, { deviceId: TILL })
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE device_id = @d').get({ d: TILL }).n, 0, 'no row on the till id')
    const queue = (await w.call('/pending', 'GET')).body.devices
    assert.deepEqual(queue.map((d) => d.device_id), [lost.body.deviceId], 'the queue holds only the fresh id')
    assert.equal((await w.call(`/${queue[0].id}/reject`)).status, 200, 'declining it')
    const genuine = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(genuine.body.success, true, 'the till with its real cookie is not locked out by that decline')
    await w.call(`/shop/${shopIdOf(w.h)}/unmark`)
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE device_id = @d').get({ d: TILL }).n, 0, 'nothing is left on the retired id')
  })

  await check('2b. with no signing key configured no cookie is trusted, so a marked device falls back to per-account approval', async () => {
    const w = setup(mutate)
    await markTill(w)
    delete w.h.env.APP_ENCRYPTION_KEY
    const res = await signIn(w, { deviceId: TILL })
    assert.equal(res.body.deviceApprovalRequired, true)
    assert.equal(sessionsOf(w.h).length, 0)
  })

  await check('3. unmark revokes the shop-path sessions (and sessions re-issued from them) but not the administrator or a personally approved one; the next sign-in needs approval', async () => {
    const w = setup(mutate)
    await markTill(w)
    const shopSignIn = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(shopSignIn.body.success, true)
    const shopSession = sessionsOf(w.h)[0]
    const insert = (id, userId, device, family) => w.h.raw.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, device_id, expires_at, limit_family_id)
      VALUES (@id, @userId, @token, @device, '2999-01-01', @family)`).run({ id, userId, token: `tok-${id}`, device, family })
    insert(101, 12, TILL, shopSession.id)
    insert(102, 11, TILL, null)
    approve(w.h, 'phone-0003', 10)
    insert(103, 10, 'phone-0003', null)
    insert(104, 12, 'elsewhere-0001', null)
    const shopId = w.h.raw.prepare('SELECT id FROM shop_devices WHERE unmarked_at IS NULL').get({}).id
    const res = await w.call(`/shop/${shopId}/unmark`)
    assert.equal(res.status, 200)
    assert.equal(res.body.revokedSessions, 2, 'the tagged sign-in and its re-issue')
    assert.deepEqual(live(w.h), [102, 103, 104], 'administrator, personally approved (on another device) and other-device sessions survive')
    const next = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(next.body.deviceApprovalRequired, true, 'back to per-account approval')
    assert.notEqual(next.body.deviceId, TILL, 'the retired id is replaced by a fresh one')
    assert.deepEqual(trusted(w.h, 12), [{ device_id: next.body.deviceId, status: 'pending' }])
    assert.equal((await w.call(`/shop/${shopId}/unmark`)).body.idempotent, true, 'unmark twice is harmless')
  })

  await check('4. only an administrator may mark, list or unmark: a non-admin gets 403 and nothing changes', async () => {
    const w = setup(mutate)
    approve(w.h, TILL, 10)
    const id = rowId(w.h, 10, TILL)
    w.as(CASHIER)
    for (const [p, m, b] of [[`/${id}/mark-shop`, 'POST', { label: 'Till 1' }], ['/shop', 'GET'], ['/shop/1/unmark', 'POST']]) {
      const res = await w.call(p, m, b)
      assert.equal(res.status, 403, `${m} ${p}`)
    }
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM shop_devices').get({}).n, 0)
    w.as(ADMIN)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: 'Till 1' })).status, 200)
    w.as(CASHIER)
    assert.equal((await w.call('/shop/1/unmark')).status, 403)
    assert.equal(w.h.raw.prepare('SELECT unmarked_at FROM shop_devices WHERE id = 1').get({}).unmarked_at, null, 'still marked')
  })

  await check('5. mark validates: label required, row must be approved, one active marking; list shows it; audit rows written for mark and unmark', async () => {
    const w = setup(mutate)
    approve(w.h, TILL, 10)
    w.h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'pending-dev-0001', 'rejected')`).run({})
    const id = rowId(w.h, 10, TILL)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: '   ' })).status, 400)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: 'x'.repeat(61) })).status, 400)
    assert.equal((await w.call(`/${rowId(w.h, 10, 'pending-dev-0001')}/mark-shop`, 'POST', { label: 'Till' })).status, 409)
    assert.equal((await w.call('/99999/mark-shop', 'POST', { label: 'Till' })).status, 404)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: '  Till   1 ' })).status, 200)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: 'Till 1' })).status, 404, 'the row the marking replaced is gone')
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (12, @d, 'pending')").run({ d: TILL })
    assert.equal((await w.call(`/${rowId(w.h, 12, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })).body.code, 'shop_device_exists')
    const list = await w.call('/shop', 'GET')
    assert.equal(list.body.shopDevices.length, 1)
    assert.equal(list.body.shopDevices[0].label, 'Till 1')
    assert.equal(list.body.shopDevices[0].device_id, TILL)
    assert.equal(list.body.shopDevices[0].marked_by_name, 'Owner')
    await w.call(`/shop/${list.body.shopDevices[0].id}/unmark`)
    assert.deepEqual(w.audits.map((a) => a[0]), ['shop_device_marked', 'shop_device_rows_removed', 'shop_device_unmarked'])
    assert.equal((await w.call('/shop', 'GET')).body.shopDevices.length, 0)
  })

  await check('6. an inactive or deleted employee is still refused on a shop device', async () => {
    const w = setup(mutate)
    await markTill(w)
    w.h.raw.prepare('UPDATE users SET is_active = 0 WHERE id = 12').run({})
    const inactive = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.notEqual(inactive.status, 200)
    assert.equal(inactive.body.success, undefined)
    w.h.raw.prepare('UPDATE users SET is_active = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = 12').run({})
    const deleted = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.notEqual(deleted.status, 200)
    assert.equal(sessionsOf(w.h).length, 0)
  })

  await check('7. administrators stay exempt: no row, no shop tag; an account an admin rejected on this device stays rejected', async () => {
    const w = setup(mutate)
    await markTill(w)
    const admin = await signIn(w, { username: 'owner', deviceId: TILL, cookieFor: TILL })
    assert.equal(admin.body.success, true)
    assert.equal(sessionsOf(w.h).find((s) => s.user_id === 11).shop_device_id, null)
    assert.deepEqual(trusted(w.h, 11), [])
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (12, @d, 'rejected')").run({ d: TILL })
    const rejected = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.body.code, 'device_rejected')
  })

  await check('8. D1 statements per /login: approved, on a shop device, new pending (the shop check adds none to the approved path)', async () => {
    const w = setup(mutate)
    await markTill(w)
    approve(w.h, 'personal-device-01', 12)
    const twice = async (options) => { await countStatements(w.h, () => signIn(w, options)); return countStatements(w.h, () => signIn(w, options)) }
    const approvedCookie = await twice({ username: 'dara', deviceId: 'personal-device-01', cookieFor: 'personal-device-01' })
    const shop = await twice({ username: 'dara', deviceId: TILL, cookieFor: TILL })
    const pending = await countStatements(w.h, () => signIn(w, { username: 'sokha', deviceId: 'brand-new-device-1' }))
    console.log(`     /login D1 statements: approved (with its cookie) ${approvedCookie}, shop device ${shop}, new pending ${pending}`)
    assert.ok(shop <= approvedCookie, 'a shop sign-in costs no more than an approved one')
  })

  await check('9. every session-issuing path passes the shop id and hands the cookie flag to the gate (source pin)', () => {
    const text = fs.readFileSync(path.join(SRC, 'routes/auth.ts'), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(text.split('cookieVerified: isCookieVerifiedDevice(c,').length - 1, 3, 'login, otp verify, google callback')
    assert.equal(text.split(/(?<![.\w])shopDeviceId,|shopDeviceId: oauthShopDeviceId,/).length - 1, 3, 'three createSession calls carry it')
    assert.equal(text.split('= trustCheck.shopDeviceId').length - 1, 3, 'three gates record it')
    assert.ok(text.includes('shopDeviceId: source.shopDeviceId,'), '/session-duration passes the source session tag on')
  })

  await check('10. a shop session re-issued by /session-duration is still revoked by unmark after retention purged every revoked row (M1)', async () => {
    const w = setup(mutate)
    await markTill(w)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.success, true)
    w.actAs(12)
    const viaRoute = await w.h.request('/session-duration', 'POST', { sessionDuration: 'standard' }, { headers: { 'User-Agent': UA, Cookie: `bos_session=${w.tokens[0]}` } })
    assert.equal(viaRoute.status, 200, JSON.stringify(viaRoute.body))
    const second = w.tokens[w.tokens.length - 1]
    assert.notEqual(second, w.tokens[0], 'the route issued a new session (the route line that passes the shop tag is exercised for real, not by source text)')
    await reissueFrom(w, second)
    w.h.raw.prepare('DELETE FROM user_sessions WHERE revoked_at IS NOT NULL').run({})
    const rows = sessionsOf(w.h)
    assert.equal(rows.length, 1, 'only the newest re-issue is left')
    const shopId = shopIdOf(w.h)
    assert.equal(rows[0].shop_device_id, shopId, 'the tag travelled through both re-issues')
    const res = await w.call(`/shop/${shopId}/unmark`)
    assert.equal(res.body.revokedSessions, 1)
    assert.deepEqual(live(w.h), [])
  })

  await check('11. only a decline made after the marking locks an employee out of the till; an earlier decline, a revoke and a replace never do (M2)', async () => {
    const w = setup(mutate)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.deviceApprovalRequired, true)
    assert.equal((await w.call(`/${rowId(w.h, 12, TILL)}/reject`)).status, 200, 'declined before the till is marked')
    w.h.raw.prepare("UPDATE trusted_devices SET decided_at = datetime('now', '-1 minute') WHERE user_id = 12").run({})
    await markTill(w)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.success, true, 'the earlier decline does not lock her out')
    w.h.raw.prepare("UPDATE trusted_devices SET status = 'rejected', revoked_at = CURRENT_TIMESTAMP, decided_at = datetime('now', '+1 minute') WHERE user_id = 12").run({})
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.success, true, 'a revoked or replaced row never does, however late')
    w.h.raw.prepare("UPDATE trusted_devices SET revoked_at = NULL WHERE user_id = 12").run({})
    const after = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(after.status, 403, 'a decline made after the marking still outranks it')
    assert.equal(after.body.code, 'device_rejected')
  })

  await check('11b. an employee replaced at the device cap on the till still signs in there (replace marks the row rejected)', async () => {
    const w = setup(mutate)
    await markTill(w)
    for (let n = 1; n <= 4; n++) approve(w.h, `own-device-000${n}`, 10)
    approve(w.h, TILL, 10)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'new-phone-0001', 'pending')").run({})
    const replaced = await w.call(`/${rowId(w.h, 10, 'new-phone-0001')}/approve-replacing`, 'POST', { revokeId: rowId(w.h, 10, TILL) })
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body))
    assert.equal((await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })).body.success, true)
  })

  await check('12. marking removes the pending and approved rows of that browser (any employee), audits them, and leaves other devices alone (M2)', async () => {
    const w = setup(mutate)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.deviceApprovalRequired, true)
    w.h.addUser({ id: 13, username: 'vanna', name: 'Vanna', roleCode: 'cashier' })
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (13, @d, 'pending'), (12, 'other-phone-0001', 'pending')").run({ d: TILL })
    approve(w.h, TILL, 10)
    const approvedRow = rowId(w.h, 10, TILL)
    const marked = await w.call(`/${approvedRow}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(marked.status, 200)
    assert.equal(marked.body.removedRows, 3, 'both waiting requests and the approved row the marking replaces')
    const pending = (await w.call('/pending', 'GET')).body.devices || []
    assert.deepEqual(pending.map((d) => d.device_id), ['other-phone-0001'])
    const closed = w.audits.find((a) => a[0] === 'shop_device_rows_removed')
    assert.ok(closed, 'an audit row names what was closed')
    assert.deepEqual(closed[3].closedRows.map((r) => r.userId).sort(), [10, 12, 13])
    assert.equal(trusted(w.h, 10).length, 0, 'the marking employee keeps no row (no slot used, nothing left to outlive an unmark)')
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (13, @d, 'pending')").run({ d: TILL })
    const dup = await w.call(`/${rowId(w.h, 13, TILL)}/mark-shop`, 'POST', { label: 'Again' })
    assert.equal(dup.body.code, 'shop_device_exists')
  })

  await check('13. a till can be marked from its pending request: no slot used, the request disappears, and after unmark that employee needs approval like everyone (L1)', async () => {
    const w = setup(mutate)
    for (let n = 1; n <= 5; n++) approve(w.h, `own-device-000${n}`, 10)
    assert.equal((await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })).body.deviceApprovalRequired, true)
    const pendingRow = rowId(w.h, 10, TILL)
    assert.equal((await w.call(`/${pendingRow}/mark-shop`, 'POST', { label: 'Till 1' })).status, 200)
    assert.equal(trusted(w.h, 10).filter((r) => r.status === 'approved').length, 5, 'her five personal approvals are untouched')
    assert.equal(trusted(w.h, 10).length, 5, 'the pending request is gone, and no sixth row')
    assert.equal((await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })).body.success, true)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.success, true)
    await w.call(`/shop/${shopIdOf(w.h)}/unmark`)
    const after = await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })
    assert.equal(after.body.deviceApprovalRequired, true, 'the marking employee needs an approval again, as the unmark dialog says')
  })

  await check('14. D1 cost of the admin calls: mark = 2 reads + 1 batch of 2 statements, 3 when approved rows exist (+ audit writes); unmark = 1 read + 1 batch of 2 (+ audit)', async () => {
    const w = setup(mutate)
    approve(w.h, TILL, 10)
    const tally = async (run) => {
      let reads = 0
      let batches = 0
      let batched = 0
      const prepare = w.h.db.prepare.bind(w.h.db)
      const batch = w.h.db.batch.bind(w.h.db)
      w.h.db.prepare = (sql) => { reads += 1; return prepare(sql) }
      w.h.db.batch = (items) => { batches += 1; batched += items.length; return batch(items) }
      try { await run() } finally { w.h.db.prepare = prepare; w.h.db.batch = batch }
      return { prepared: reads, batches, batched }
    }
    const mark = await tally(() => w.call(`/${rowId(w.h, 10, TILL)}/mark-shop`, 'POST', { label: 'Till 1' }))
    const unmark = await tally(() => w.call(`/shop/${shopIdOf(w.h)}/unmark`))
    console.log(`     mark: ${JSON.stringify(mark)}  unmark: ${JSON.stringify(unmark)} (audit writes not counted: stubbed)`)
    assert.deepEqual(mark, { prepared: 2, batches: 1, batched: 3 }, 'an approved row adds the session-tag statement to the batch')
    const pendingOnly = setup(mutate)
    pendingOnly.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, @d, 'pending')").run({ d: TILL })
    const prepare2 = pendingOnly.h.db.prepare.bind(pendingOnly.h.db)
    const batch2 = pendingOnly.h.db.batch.bind(pendingOnly.h.db)
    let batched2 = 0
    pendingOnly.h.db.prepare = (sql) => prepare2(sql)
    pendingOnly.h.db.batch = (items) => { batched2 += items.length; return batch2(items) }
    await pendingOnly.call(`/${rowId(pendingOnly.h, 10, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(batched2, 2, 'a pending request has no sessions to tag: still 2 statements')
    assert.deepEqual(unmark, { prepared: 1, batches: 1, batched: 2 })
  })

  await check('15. a shop sign-in records where the till was last used and raises the new-country alert a personal device raises (L2)', async () => {
    const w = setup(mutate)
    await markTill(w)
    const shop = () => w.h.raw.prepare('SELECT last_seen_at, last_ip, last_country FROM shop_devices WHERE unmarked_at IS NULL').get({})
    assert.equal((await signIn(w, { deviceId: TILL, cookieFor: TILL, country: 'KH' })).body.success, true)
    assert.equal(shop().last_country, 'KH')
    assert.equal(shop().last_ip, '203.0.113.5')
    assert.ok(shop().last_seen_at, 'the time is recorded')
    assert.equal(w.trustAudits.filter((a) => a.action === 'device_login_new_country').length, 0, 'no alert for the first country')
    let abroad
    const wrote = async (run) => { const seen = []; const prepare = w.h.db.prepare.bind(w.h.db); w.h.db.prepare = (sql) => { seen.push(sql); return prepare(sql) }; try { await run() } finally { w.h.db.prepare = prepare } return seen.some((sql) => /UPDATE shop_devices SET last_seen_at/.test(sql)) }
    const changedWrote = await wrote(async () => { abroad = await signIn(w, { deviceId: TILL, cookieFor: TILL, country: 'US' }) })
    assert.equal(abroad.body.success, true, 'the alert does not block the employee')
    const alerts = w.trustAudits.filter((a) => a.action === 'device_login_new_country')
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].details.previousCountry, 'KH')
    assert.equal(alerts[0].details.newCountry, 'US')
    assert.equal(alerts[0].details.shopDevice, true)
    assert.equal(alerts[0].details.deviceName, 'Till 1', "the bell (routes/notifications.ts reads details.deviceName) shows the till's label, not 'Device for user #12' (L-3)")
    assert.match(fs.readFileSync(path.join(SRC, 'routes/notifications.ts'), 'utf8'), /label: parsed.deviceName ||/, 'and the bell still reads that field')
    assert.equal(shop().last_country, 'US', 'the till is now seen from the new country')
    const listed = (await w.call('/shop', 'GET')).body.shopDevices[0]
    assert.equal(listed.last_country, 'US')
    const repeatWrote = await wrote(() => signIn(w, { deviceId: TILL, cookieFor: TILL, country: 'US' }))
    assert.equal(changedWrote, true, 'a change of country is written')
    assert.equal(repeatWrote, false, 'a repeat from the same place and time adds no write (no extra D1 call on an ordinary shop sign-in)')
  })

  await check('16. unmarking retires the till id: a copied cookie of it stops working, the till continues under a fresh id that is marked from its pending request (L2)', async () => {
    const w = setup(mutate)
    await markTill(w)
    assert.equal((await signIn(w, { deviceId: TILL, cookieFor: TILL })).body.success, true)
    await w.call(`/shop/${shopIdOf(w.h)}/unmark`)
    const tillNext = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(tillNext.body.deviceApprovalRequired, true)
    const fresh = tillNext.body.deviceId
    assert.notEqual(fresh, TILL)
    const thief = await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })
    assert.equal(thief.body.deviceApprovalRequired, true, 'the copy gets no access')
    assert.notEqual(thief.body.deviceId, TILL, 'and no row is ever created for the retired id again')
    const bodyOnly = await signIn(w, { username: 'sokha', deviceId: TILL })
    assert.notEqual(bodyOnly.body.deviceId, TILL, 'also for a body-only id')
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE device_id = @d').get({ d: TILL }).n, 0)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (12, @d, 'pending')").run({ d: TILL })
    const refused = await w.call(`/${rowId(w.h, 12, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'shop_device_retired')
    assert.equal((await w.call(`/${rowId(w.h, 12, fresh)}/mark-shop`, 'POST', { label: 'Till 1' })).status, 200, 'the till is marked again from its new pending request')
    assert.equal((await signIn(w, { username: 'sokha', deviceId: fresh, cookieFor: fresh })).body.success, true, 'the till works under its new id')
    const stale = await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })
    assert.equal(stale.body.deviceApprovalRequired, true, 'the copied cookie of the old id still gets nothing')
  })

  await check('18. M-1: an approval on a retired till id is refused with 409 shop_device_retired, by /approve and /approve-replacing, and the row stays pending', async () => {
    const w = setup(mutate)
    await markTill(w)
    await w.call(`/shop/${shopIdOf(w.h)}/unmark`)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (12, @d, 'pending')").run({ d: TILL })
    const id = rowId(w.h, 12, TILL)
    const plain = await w.call(`/${id}/approve`)
    assert.equal(plain.status, 409)
    assert.equal(plain.body.code, 'shop_device_retired')
    approve(w.h, 'old-phone-0001', 12)
    const replacing = await w.call(`/${id}/approve-replacing`, 'POST', { revokeId: rowId(w.h, 12, 'old-phone-0001') })
    assert.equal(replacing.status, 409)
    assert.equal(replacing.body.code, 'shop_device_retired')
    assert.equal(trusted(w.h, 12).find((r) => r.device_id === TILL).status, 'pending')
    assert.equal(trusted(w.h, 12).find((r) => r.device_id === 'old-phone-0001').status, 'approved', 'the old device was not revoked either')
    approve(w.h, 'ordinary-phone-01', 10)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'other-new-phone-1', 'pending')").run({})
    assert.equal((await w.call(`/${rowId(w.h, 10, 'other-new-phone-1')}/approve`)).status, 200, 'an ordinary request is approved as before')
  })

  await check('19. L-1: marking tags the live sessions of employees whose personal approval it deletes, so unmark revokes them; administrators and other devices are untouched', async () => {
    const w = setup(mutate)
    approve(w.h, TILL, 10)
    const insert = (id, userId, device, revoked = false) => w.h.raw.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, device_id, expires_at, revoked_at)
      VALUES (@id, @userId, @token, @device, '2999-01-01', CASE WHEN @revoked = 1 THEN CURRENT_TIMESTAMP END)`).run({ id, userId, token: `tok-${id}`, device, revoked: revoked ? 1 : 0 })
    insert(201, 10, TILL)
    insert(202, 10, TILL)
    insert(203, 10, 'elsewhere-0001')
    insert(204, 11, TILL)
    insert(205, 12, TILL)
    insert(206, 10, TILL, true)
    const marked = await w.call(`/${rowId(w.h, 10, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(marked.status, 200)
    const shopId = shopIdOf(w.h)
    const tags = Object.fromEntries(sessionsOf(w.h).map((s) => [s.id, s.shop_device_id]))
    assert.deepEqual([tags[201], tags[202]], [shopId, shopId], 'her two live sessions on the till are tagged')
    assert.deepEqual([tags[203], tags[204], tags[205], tags[206]], [null, null, null, null], 'another device, the administrator, an employee with no approved row here and a revoked session stay untagged')
    assert.equal(w.audits.find((a) => a[0] === 'shop_device_rows_removed')[3].taggedSessions, 2)
    const unmarked = await w.call(`/shop/${shopId}/unmark`)
    assert.equal(unmarked.body.revokedSessions, 2)
    assert.deepEqual(live(w.h), [203, 204, 205], 'the tagged sessions are revoked, nothing else')
  })

  await check('20. L-2: the claimed-id warning is only for an id that arrived without its cookie; the genuine device with its cookie on a retired id claims nothing', async () => {
    const w = setup(mutate)
    await markTill(w)
    await w.call(`/shop/${shopIdOf(w.h)}/unmark`)
    approve(w.h, TILL, 12) // an approved row that still names the retired id
    const claimedOf = (deviceId) => w.h.raw.prepare('SELECT claimed_approval_ref AS c FROM trusted_devices WHERE device_id = @d').get({ d: deviceId }).c
    const genuine = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(genuine.body.deviceApprovalRequired, true)
    assert.equal(claimedOf(genuine.body.deviceId), null, 'cookie in hand: nothing claimed')
    assert.equal(w.trustAudits.some((a) => a.details && a.details.claimedTrustedDeviceRowId), false)
    const bodyOnly = await signIn(w, { username: 'dara', deviceId: TILL })
    assert.equal(bodyOnly.body.deviceApprovalRequired, true)
    assert.equal(claimedOf(bodyOnly.body.deviceId), rowId(w.h, 12, TILL), 'no cookie: the claim is recorded')
  })

  await check('21. L-4: a pending request on an id another account holds an approved device for cannot be marked (409 shop_device_held); the approved device itself can', async () => {
    const w = setup(mutate)
    approve(w.h, TILL, 10)
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (12, @d, 'pending')").run({ d: TILL })
    const before = w.h.raw.prepare('SELECT user_id, status FROM trusted_devices ORDER BY id').all({}).map((r) => ({ ...r }))
    const refused = await w.call(`/${rowId(w.h, 12, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'shop_device_held')
    assert.deepEqual(w.h.raw.prepare('SELECT user_id, status FROM trusted_devices ORDER BY id').all({}).map((r) => ({ ...r })), before, 'her approved row and the request are untouched')
    assert.equal(w.h.raw.prepare('SELECT COUNT(*) AS n FROM shop_devices').get({}).n, 0)
    assert.equal(w.audits.length, 0, 'nothing audited as removed')
    const fromApproved = await w.call(`/${rowId(w.h, 10, TILL)}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(fromApproved.status, 200, 'marking from the approved device is the intended way, and it still closes the request')
    assert.equal(fromApproved.body.removedRows, 2)
  })

  await check('17. the pending list tells the administrator which approved device a request claimed (L4); a plain new device claims nothing', async () => {
    const w = setup(mutate)
    approve(w.h, 'claimed-phone-0001', 12)
    w.h.raw.prepare("UPDATE trusted_devices SET cookie_bound_at = CURRENT_TIMESTAMP, device_name = 'Dara phone'").run({})
    const claim = await signIn(w, { deviceId: 'claimed-phone-0001' })
    assert.equal(claim.body.deviceApprovalRequired, true)
    const plain = await signIn(w, { username: 'sokha', deviceId: 'brand-new-device-9' })
    assert.equal(plain.body.deviceApprovalRequired, true)
    const pending = (await w.call('/pending', 'GET')).body.devices
    const claimed = pending.find((d) => d.user_id === 12)
    assert.equal(claimed.claimed_approval_ref, rowId(w.h, 12, 'claimed-phone-0001'))
    assert.equal(claimed.claimed_device_name, 'Dara phone')
    assert.equal(pending.find((d) => d.user_id === 10).claimed_approval_ref, null)
  })

  console.log(`   ${passed} passed, ${failures.length} failed`)
  return [...failures]
}

const shopIdOf = (h) => h.raw.prepare('SELECT id FROM shop_devices WHERE unmarked_at IS NULL').get({}).id
const inFile = (file, from, to) => (text, rel) => (rel === file ? text.replace(from, to) : text)
const mutants = [
  ['body id may claim a shop device (both cookie gates removed: the shop path and the fresh-id guard for a marked id)', (text, rel) => (rel === 'lib/deviceTrust.ts' ? text.replace('const shopDeviceId = meta.cookieVerified ? markedShopId : null', 'const shopDeviceId = markedShopId').replace('const markedWithoutCookie = Boolean(markedShopId) && !meta.cookieVerified', 'const markedWithoutCookie = false') : text), ['2.', '2a.']],
  ['a marked till id without its cookie gets a pending row again (M-1)', inFile('lib/deviceTrust.ts', 'const markedWithoutCookie = Boolean(markedShopId) && !meta.cookieVerified', 'const markedWithoutCookie = false'), ['2.', '2a.', '2c.']],
  ['/approve ignores a retired id', inFile('routes/devices.ts', 'if (await isRetiredShopId(db, device.device_id)) return c.json(RETIRED_SHOP_ID_ANSWER, 409)\n\n', ''), ['18.']],
  ['/approve-replacing ignores a retired id', (text, rel) => { if (rel !== 'routes/devices.ts') return text; const s = 'if (await isRetiredShopId(db, device.device_id)) return c.json(RETIRED_SHOP_ID_ANSWER, 409)\n\n  const params'; return text.replace(s, '\n  const params') }, ['18.']],
  ['shop path removed (pre-slice behaviour)', inFile('lib/deviceTrust.ts', 'if (shopDeviceId && !refusedAfterMarking', 'if (false && !refusedAfterMarking'), ['1.', '1b.', '3.']],
  ['unmark does not revoke sessions', inFile('routes/devices.ts', 'WHERE revoked_at IS NULL\n          AND (shop_device_id', 'WHERE 0 AND revoked_at IS NULL\n          AND (shop_device_id'), ['3.']],
  ['unmark revokes by device id (kills the admin session too)', inFile('routes/devices.ts', 'AND (shop_device_id = @id OR', 'AND (device_id = (SELECT device_id FROM shop_devices WHERE id = @id) OR'), ['3.']],
  ['admin guard removed from the devices router', inFile('routes/devices.ts', "if (!isAdminControlUser(c.get('user')))", 'if (false)'), ['4.']],
  ['re-issue drops the shop tag', inFile('lib/auth.ts', 'shop_device_id: shopDeviceId > 0 ? shopDeviceId : null', 'shop_device_id: null'), ['10.']],
  ['a rejected account no longer outranks the shop marking', inFile('lib/deviceTrust.ts', "const refusedAfterMarking = existing?.status === 'rejected'", "const refusedAfterMarking = false && existing?.status === 'rejected'"), ['7.', '11.']],
  ['an earlier decline or a revoke locks an employee out of the till (old rule)', (text, rel) => (rel === 'lib/deviceTrust.ts' ? text.replace(' && !existing.revoked_at', '').replace('existing.decided_at >= found.shop_marked_at', 'true').replace('(!existing.decided_at ||', '(true ||') : text), ['11.', '11b.']],
  ['mark leaves the waiting requests in the queue', inFile('routes/devices.ts', "DELETE FROM trusted_devices WHERE device_id = @device_id AND status IN ('pending', 'approved') AND changes() = 1", 'DELETE FROM trusted_devices WHERE 0'), ['12.', '13.']],
  ['the shop sign-in records nothing and raises no alert', inFile('lib/deviceTrust.ts', 'await recordShopSignIn(env, userId, deviceId, shopDeviceId, found as NonNullable<typeof found>, meta)', ''), ['15.']],
  ['the shop sign-in writes on every request (no throttle)', inFile('lib/deviceTrust.ts', 'if (recent && ip ===', 'if (false && ip ==='), ['15.']],
  ['an unmarked till id keeps working (no retirement)', inFile('lib/deviceTrust.ts', 'if (cookiesOn && (retiredShopId ||', 'if (cookiesOn && (false ||'), ['3.', '16.']],
  ['a retired id can be marked again', inFile('routes/devices.ts', 'if (device.shop_retired) {', 'if (false) {'), ['16.']],
  ['a pending row forgets which approved device it claimed', inFile('lib/deviceTrust.ts', "claimed: existing?.status === 'approved' ? existing.id : null", 'claimed: null'), ['17.']],
  ['marking does not tag the sessions it orphans (L-1)', inFile('routes/devices.ts', 'const approvedUserIds = [...new Set(', 'const approvedUserIds: number[] = [] || [...new Set('), ['19.', '14.']],
  ['a verified cookie on a retired id is still reported as a claim (L-2)', inFile('lib/deviceTrust.ts', "existing?.status === 'approved' && !meta.cookieVerified ? existing : null", "existing?.status === 'approved' ? existing : null"), ['20.']],
  ['the shop new-country alert carries no device name (L-3)', inFile('lib/deviceTrust.ts', 'deviceName: shop.shop_label || null, ', ''), ['15.']],
  ['a pending request on an id another account holds approved can be marked (L-4)', inFile('routes/devices.ts', "device.status === 'pending' && (waiting || []).some(", "false && (waiting || []).some("), ['21.']],
  ['the /session-duration route forgets the shop tag when it re-issues (L-5)', (text, rel) => (rel === 'routes/auth.ts' ? text.replace('shopDeviceId: source.shopDeviceId,', '') : text), ['10.']],
  ['marking from a pending request is refused', inFile('routes/devices.ts', "device.status !== 'approved' && device.status !== 'pending'", "device.status !== 'approved'"), ['13.']],
]

async function main() {
  const base = await suite((t) => t, 'real code')
  let bad = base.length
  const only = (process.argv.find((a) => a.startsWith('--mutant=')) || '').slice('--mutant='.length)
  const realOnly = process.argv.includes('--real-only')
  for (const [name, mutate, expectRed] of mutants) {
    if (realOnly || (only && !name.includes(only))) continue
    const red = await suite(mutate, `mutant: ${name}`)
    const missing = expectRed.filter((prefix) => !red.some((n) => n.startsWith(prefix)))
    if (missing.length) { console.log(`MUTANT SURVIVED: ${name}; checks ${missing.join(', ')} stayed green`); bad += 1 }
    else console.log(`mutant killed: ${name} (red: ${red.map((n) => n.split('.')[0]).join(', ')})`)
  }
  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-shop-device-pure: all checks passed and every mutant was killed')
}

main().catch((error) => { console.error(error); process.exit(1) })
