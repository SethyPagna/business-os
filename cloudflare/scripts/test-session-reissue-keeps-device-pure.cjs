// SEC1-01: a session re-issued by POST /api/auth/session-duration stays tied
// to the device it was re-issued on, so Devices -> Revoke / Reject kills it.
//
// The route used to take the device id from the request body. The app never
// sends one there (authTransport.updateSessionDuration spreads
// getClientDeviceInfo, which has no id), so saving "Default login duration"
// left the browser on a 10-year session with device_id NULL, and the admin's
// device revoke/reject (lib/auth.ts revokeSessionsForDevice, matched on
// device_id) revoked 0 rows for that phone.
//
// Drives the REAL lib/auth.ts (createSession, requireAuth, the session
// lookup), the real /session-duration and /me routes and the real
// routes/devices.ts revoke/reject routes over in-memory SQLite with every
// migration applied, using real Set-Cookie tokens.
//
// Pins:
//   - a re-issue carries the caller's session device_id and device_name,
//     whatever the body says (none, or another device's id);
//   - Devices -> Revoke and Reject kill the sign-in AND every re-issued
//     session of it, including one minted from a minted one;
//   - a row re-issued before this fix (device_id NULL, limit_family_id set)
//     is revoked with its family too;
//   - controls: the same account's session on another device, and another
//     account's session with the same device id, stay signed in.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { passwordHashStub, failedSignInCostStub } = require('./harness/password_hash_stub.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function load(rel, overrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (request) => Object.prototype.hasOwnProperty.call(overrides, request) ? overrides[request] : require(request),
    mod, mod.exports, sourcePath, path.dirname(sourcePath),
  )
  return mod.exports
}

const noop = async () => {}
const adapt = (raw) => ({
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params),
      run: async (params) => {
        const info = stmt.run(params)
        return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (items) => raw.batch(items),
})
const libDb = { getDb: (env) => adapt(env.DB) }
const cookie = require('hono/cookie')
const rateLimit = load('lib/rateLimit.ts', { './db': libDb, '../index': {} })
const authLib = load('lib/auth.ts', { './db': libDb, 'hono/cookie': cookie, '../index': {} })
const isAdminControlUser = (u) => Number(u?.id) === 1

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/failedSignInCost': failedSignInCostStub,
  '../lib/db': libDb,
  '../lib/auth': authLib,
  '../lib/verification': {
    issuePasswordResetLink: noop, consumePasswordResetLink: noop, isEmailConfigured: () => false,
    normalizeEmail: (v) => String(v || '').trim().toLowerCase(),
  },
  '../lib/audit': { audit: noop },
  '../lib/secretCrypto': { encryptSecret: async (v) => v, decryptSecret: async (v) => v },
  '../lib/totp': { generateTotpSecret: () => 'S', verifyTotpStep: async () => null },
  '../lib/permissions': { isAdminControlUser },
  '../lib/planTier': { resolvePlanTier: () => 'pro' },
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': {},
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': { recordFailedLogin: noop, getLoginLockoutState: async () => ({ locked: false }), clearLoginLockout: noop },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': {},
  '../index': {},
}).default

const devicesRoute = load('routes/devices.ts', {
  hono: require('hono'),
  '../lib/db': libDb,
  '../lib/auth': authLib,
  '../lib/audit': { audit: noop },
  '../lib/permissions': { isAdminControlUser },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/deviceTrust': { MAX_APPROVED_DEVICES_PER_USER: 5, countApprovedDevices: async () => 0 },
  '../index': {},
}).default

const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
let db
let env

function reset() {
  db = openDb(loadAll())
  db.prepare(`INSERT INTO users (id, username, name, password) VALUES
    (1, 'owner', 'Owner', 'hash:owner-pass'),
    (2, 'cashier', 'Cashier', 'hash:p0'),
    (3, 'other', 'Other', 'hash:p3')`).run({})
  env = { DB: db }
}

const signIn = async (userId, deviceId, deviceName) =>
  (await authLib.createSession(env, userId, { sessionDuration: 'always', deviceId, deviceName })).token

async function send(route, method, url, token, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Cookie = `bos_session=${token}`
  const init = { method, headers }
  if (method !== 'GET') init.body = JSON.stringify(body || {})
  const res = await route.request(url, init, env, ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  const minted = /bos_session=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1] || null
  return { status: res.status, body: json, text, minted }
}

// Exactly what the app sends when someone saves "Default login duration":
// AppContext.updateSessionDuration -> authTransport spreads getClientDeviceInfo()
// (clientTime / deviceTz / deviceName) and adds sessionDuration. No device id.
const APP_BODY = { sessionDuration: 'always', clientTime: '2026-09-28T01:00:00.000Z', deviceTz: 'Asia/Phnom_Penh', deviceName: 'Cashier phone' }

async function reissue(token, body = APP_BODY) {
  const res = await send(authRoute, 'POST', '/session-duration', token, body)
  assert.equal(res.status, 200, `session-duration: ${res.text}`)
  assert.ok(res.minted && res.minted !== token, 'a new session cookie was issued')
  return res.minted
}

const alive = async (token) => (await send(authRoute, 'GET', '/me', token)).status === 200
const rowCount = () => db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n
const lastRow = () => db.prepare('SELECT * FROM user_sessions ORDER BY id DESC LIMIT 1').get({})
const addDevice = (id, userId, deviceId, status) => db.prepare(`
  INSERT INTO trusted_devices (id, user_id, device_id, device_name, status) VALUES (@id, @user_id, @device_id, 'Cashier phone', @status)
`).run({ id, user_id: userId, device_id: deviceId, status })

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('a re-issue with the app\'s own body keeps the device id and name of the calling session', async () => {
    const signedIn = await signIn(2, 'phone-D', 'Cashier phone')
    const before = rowCount()
    await reissue(signedIn)
    assert.equal(rowCount(), before + 1)
    const row = lastRow()
    assert.equal(row.device_id, 'phone-D', 're-issued row carries the device id')
    assert.equal(row.device_name, 'Cashier phone', 're-issued row carries the device name')
  })

  await check('the body cannot re-home a re-issue onto another device id or name', async () => {
    const signedIn = await signIn(2, 'phone-D', 'Cashier phone')
    await reissue(signedIn, { ...APP_BODY, deviceId: 'somewhere-else', deviceName: 'Front till' })
    const row = lastRow()
    assert.equal(row.device_id, 'phone-D')
    assert.equal(row.device_name, 'Cashier phone')
  })

  await check('Devices -> Revoke kills the sign-in and every re-issued session of it', async () => {
    addDevice(1, 2, 'phone-D', 'approved')
    const signedIn = await signIn(2, 'phone-D', 'Cashier phone')
    const child = await reissue(signedIn)
    const grandchild = await reissue(child, { sessionDuration: '7d' })
    const renamed = await reissue(signedIn, { ...APP_BODY, deviceId: 'somewhere-else' })
    const otherDevice = await signIn(2, 'tablet-E', 'Shop tablet')
    const otherDeviceChild = await reissue(otherDevice)
    const otherUser = await signIn(3, 'phone-D', 'Cashier phone')
    const admin = await signIn(1, 'owner-laptop', 'Owner laptop')
    for (const t of [signedIn, child, grandchild, renamed]) assert.equal(await alive(t), true, 'live before the revoke')

    const res = await send(devicesRoute, 'POST', '/1/revoke', admin)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.revokedSessions, 4, `the audit count names every session of the device: ${res.text}`)
    for (const [label, t] of [['sign-in', signedIn], ['re-issue', child], ['re-issue of a re-issue', grandchild], ['re-issue with a body device id', renamed]]) {
      assert.equal(await alive(t), false, `${label} is signed out by the device revoke`)
    }
    assert.equal(await alive(otherDevice), true, 'control: same account, another device, still signed in')
    assert.equal(await alive(otherDeviceChild), true, 'control: that device\'s own re-issue is untouched')
    assert.equal(await alive(otherUser), true, 'control: another account with the same device id is untouched')
    assert.equal(await alive(admin), true)
  })

  await check('Devices -> Reject kills the re-issued session too', async () => {
    addDevice(2, 2, 'phone-D', 'pending')
    const signedIn = await signIn(2, 'phone-D', 'Cashier phone')
    const child = await reissue(signedIn)
    const admin = await signIn(1, 'owner-laptop', 'Owner laptop')
    const res = await send(devicesRoute, 'POST', '/2/reject', admin)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.revokedSessions, 2, res.text)
    assert.equal(await alive(signedIn), false)
    assert.equal(await alive(child), false, 'the re-issued session dies with its device')
  })

  await check('a session re-issued before this fix (device_id NULL) is revoked with its sign-in family', async () => {
    addDevice(3, 2, 'phone-D', 'approved')
    const signedIn = await signIn(2, 'phone-D', 'Cashier phone')
    const root = lastRow()
    const orphanChild = await reissue(signedIn)
    const orphanGrandchild = await reissue(orphanChild)
    // Rewrite both to the shape the old route stored: no device id or name.
    db.prepare('UPDATE user_sessions SET device_id = NULL, device_name = NULL WHERE limit_family_id = @root').run({ root: root.id })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE limit_family_id = @root AND device_id IS NULL').get({ root: root.id }).n, 2)
    const otherFamily = await signIn(2, 'tablet-E', 'Shop tablet')
    const otherFamilyChild = await reissue(otherFamily)
    db.prepare("UPDATE user_sessions SET device_id = NULL WHERE device_id = 'tablet-E' AND limit_family_id IS NOT NULL").run({})
    const admin = await signIn(1, 'owner-laptop', 'Owner laptop')

    const res = await send(devicesRoute, 'POST', '/3/revoke', admin)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.revokedSessions, 3, res.text)
    assert.equal(await alive(orphanChild), false, 'old NULL re-issue is revoked through its family')
    assert.equal(await alive(orphanGrandchild), false)
    assert.equal(await alive(otherFamilyChild), true, 'control: a NULL re-issue of ANOTHER device\'s sign-in stays')
    assert.equal(await alive(otherFamily), true)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
