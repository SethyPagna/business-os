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
  const h = createAuthHarness({
    overrides: {
      '../lib/auth': {
        createSession: async (...args) => { const made = await authLib.createSession(...args); tokens.push(made.token); return made },
        setSessionCookie: () => {},
        clearSessionCookie: () => {},
        getSessionUser: async () => null,
        revokeSession: async () => {},
        revokeUserSessions: async () => {},
        requireAuth: async (c, next) => next(),
      },
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  const stubs = { './db': { getDb: () => h.db }, './audit': { audit: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async () => {} } }
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
  return { h, cookieLib, audits, as, call, authLib, tokens }
}

const trusted = (h, userId) => h.raw.prepare('SELECT device_id, status FROM trusted_devices WHERE user_id = @userId ORDER BY id').all({ userId }).map((r) => ({ ...r }))
const approve = (h, deviceId, userId = 10) => h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at)
  VALUES (@userId, @deviceId, 'Till tablet', 'approved', CURRENT_TIMESTAMP)`).run({ userId, deviceId })
const rowId = (h, userId, deviceId) => h.raw.prepare('SELECT id FROM trusted_devices WHERE user_id = @userId AND device_id = @deviceId').get({ userId, deviceId }).id
const sessionsOf = (h) => h.raw.prepare('SELECT id, user_id, device_id, shop_device_id, revoked_at FROM user_sessions ORDER BY id').all({}).map((r) => ({ ...r }))
const live = (h) => sessionsOf(h).filter((s) => !s.revoked_at).map((s) => s.id)

async function markTill(world, deviceId = TILL, label = 'Till 1') {
  approve(world.h, deviceId, 10)
  const res = await world.call(`/${rowId(world.h, 10, deviceId)}/mark-shop`, 'POST', { label })
  assert.equal(res.status, 200, JSON.stringify(res.body))
}

async function signIn(world, { username = 'dara', deviceId, cookieFor, cookie } = {}) {
  const headers = { 'User-Agent': UA }
  const value = cookie || (cookieFor ? await world.cookieLib.signDeviceCookieValue(world.h.env, cookieFor) : null)
  if (value) headers.Cookie = `${COOKIE}=${value}`
  return world.h.request('/login', 'POST', { username, password: 'correct-horse', deviceId, deviceName: 'Tablet' }, { ip: '203.0.113.5', headers })
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
    insert(103, 10, TILL, null)
    insert(104, 12, 'elsewhere-0001', null)
    const shopId = w.h.raw.prepare('SELECT id FROM shop_devices WHERE unmarked_at IS NULL').get({}).id
    const res = await w.call(`/shop/${shopId}/unmark`)
    assert.equal(res.status, 200)
    assert.equal(res.body.revokedSessions, 2, 'the tagged sign-in and its re-issue')
    assert.deepEqual(live(w.h), [102, 103, 104], 'administrator, personally approved and other-device sessions survive')
    const next = await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })
    assert.equal(next.body.deviceApprovalRequired, true, 'back to per-account approval')
    assert.deepEqual(trusted(w.h, 12), [{ device_id: TILL, status: 'pending' }])
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
    w.h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'pending-dev-0001', 'pending')`).run({})
    const id = rowId(w.h, 10, TILL)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: '   ' })).status, 400)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: 'x'.repeat(61) })).status, 400)
    assert.equal((await w.call(`/${rowId(w.h, 10, 'pending-dev-0001')}/mark-shop`, 'POST', { label: 'Till' })).status, 409)
    assert.equal((await w.call('/99999/mark-shop', 'POST', { label: 'Till' })).status, 404)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: '  Till   1 ' })).status, 200)
    assert.equal((await w.call(`/${id}/mark-shop`, 'POST', { label: 'Till 1' })).body.code, 'shop_device_exists')
    const list = await w.call('/shop', 'GET')
    assert.equal(list.body.shopDevices.length, 1)
    assert.equal(list.body.shopDevices[0].label, 'Till 1')
    assert.equal(list.body.shopDevices[0].device_id, TILL)
    assert.equal(list.body.shopDevices[0].marked_by_name, 'Owner')
    await w.call(`/shop/${list.body.shopDevices[0].id}/unmark`)
    assert.deepEqual(w.audits.map((a) => a[0]), ['shop_device_marked', 'shop_device_unmarked'])
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
    const second = await reissueFrom(w, w.tokens[0])
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
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (10, 'new-phone-0001', 'pending')").run({})
    const replaced = await w.call(`/${rowId(w.h, 10, 'new-phone-0001')}/approve-replacing`, 'POST', { revokeId: rowId(w.h, 10, TILL) })
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body))
    assert.equal((await signIn(w, { username: 'sokha', deviceId: TILL, cookieFor: TILL })).body.success, true)
  })

  await check('12. marking removes the requests still waiting for that browser (any employee), audits them, and leaves other devices alone (M2)', async () => {
    const w = setup(mutate)
    assert.equal((await signIn(w, { username: 'dara', deviceId: TILL, cookieFor: TILL })).body.deviceApprovalRequired, true)
    w.h.addUser({ id: 13, username: 'vanna', name: 'Vanna', roleCode: 'cashier' })
    w.h.raw.prepare("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (13, @d, 'pending'), (12, 'other-phone-0001', 'pending')").run({ d: TILL })
    approve(w.h, TILL, 10)
    const approvedRow = rowId(w.h, 10, TILL)
    const marked = await w.call(`/${approvedRow}/mark-shop`, 'POST', { label: 'Till 1' })
    assert.equal(marked.status, 200)
    assert.equal(marked.body.closedPending, 2, 'both waiting requests, not the marking row')
    const pending = (await w.call('/pending', 'GET')).body.devices || []
    assert.deepEqual(pending.map((d) => d.device_id), ['other-phone-0001'])
    const closed = w.audits.find((a) => a[0] === 'shop_device_pending_closed')
    assert.ok(closed, 'an audit row names what was closed')
    assert.deepEqual(closed[3].closedRequests.map((r) => r.userId).sort(), [12, 13])
    const dup = await w.call(`/${approvedRow}/mark-shop`, 'POST', { label: 'Again' })
    assert.equal(dup.body.code, 'shop_device_exists')
  })

  console.log(`   ${passed} passed, ${failures.length} failed`)
  return [...failures]
}

const shopIdOf = (h) => h.raw.prepare('SELECT id FROM shop_devices WHERE unmarked_at IS NULL').get({}).id
const inFile = (file, from, to) => (text, rel) => (rel === file ? text.replace(from, to) : text)
const mutants = [
  ['body id may claim a shop device (cookie gate removed)', inFile('lib/deviceTrust.ts', '@shop_ok = 1 AND', '1 = 1 AND'), ['2.']],
  ['shop path removed (pre-slice behaviour)', inFile('lib/deviceTrust.ts', 'if (shopDeviceId && !refusedAfterMarking', 'if (false && !refusedAfterMarking'), ['1.', '1b.', '3.']],
  ['unmark does not revoke sessions', inFile('routes/devices.ts', 'WHERE revoked_at IS NULL\n          AND (shop_device_id', 'WHERE 0 AND revoked_at IS NULL\n          AND (shop_device_id'), ['3.']],
  ['unmark revokes by device id (kills the admin session too)', inFile('routes/devices.ts', 'AND (shop_device_id = @id OR', 'AND (device_id = (SELECT device_id FROM shop_devices WHERE id = @id) OR'), ['3.']],
  ['admin guard removed from the devices router', inFile('routes/devices.ts', "if (!isAdminControlUser(c.get('user')))", 'if (false)'), ['4.']],
  ['re-issue drops the shop tag', inFile('lib/auth.ts', 'shop_device_id: shopDeviceId > 0 ? shopDeviceId : null', 'shop_device_id: null'), ['10.']],
  ['a rejected account no longer outranks the shop marking', inFile('lib/deviceTrust.ts', "const refusedAfterMarking = existing?.status === 'rejected'", "const refusedAfterMarking = false && existing?.status === 'rejected'"), ['7.', '11.']],
  ['an earlier decline or a revoke locks an employee out of the till (old rule)', (text, rel) => (rel === 'lib/deviceTrust.ts' ? text.replace(' && !existing.revoked_at', '').replace('existing.decided_at >= found.shop_marked_at', 'true').replace('(!existing.decided_at ||', '(true ||') : text), ['11.', '11b.']],
  ['mark leaves the waiting requests in the queue', inFile('routes/devices.ts', "DELETE FROM trusted_devices WHERE device_id = @device_id AND status = 'pending' AND changes() = 1", 'DELETE FROM trusted_devices WHERE 0'), ['12.']],
]

async function main() {
  const base = await suite((t) => t, 'real code')
  let bad = base.length
  for (const [name, mutate, expectRed] of mutants) {
    const red = await suite(mutate, `mutant: ${name}`)
    const missing = expectRed.filter((prefix) => !red.some((n) => n.startsWith(prefix)))
    if (missing.length) { console.log(`MUTANT SURVIVED: ${name}; checks ${missing.join(', ')} stayed green`); bad += 1 }
    else console.log(`mutant killed: ${name} (red: ${red.map((n) => n.split('.')[0]).join(', ')})`)
  }
  if (bad) { console.log(`\n${bad} problem(s)`); process.exit(1) }
  console.log('\ntest-shop-device-pure: all checks passed and every mutant was killed')
}

main().catch((error) => { console.error(error); process.exit(1) })
