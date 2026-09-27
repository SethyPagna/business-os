// A Google sign-in answered with buildUserPayload(synced): the account's own
// fields only. POST /login and the authenticator step (POST /otp/verify)
// answer with the role half too -- role_code and role_permissions -- and since
// FX-sec both the app and the Worker decide administrator control from that
// half (role code `admin` or an effective `all` grant), not from the username.
// So a Google sign-in
//   - signed the person in without their role: most accounts hold every grant
//     on the role, so the app mounted with no permissions whenever its
//     bootstrap re-fetch could not run, and an administrator was not one;
//   - handed the device gate the account without its role, so an
//     administrator signing in with Google on a new device was held for
//     approval -- the one account that approves devices.
//
// Drives the REAL routes/auth.ts (harness/load_auth_route.cjs, every
// migration applied) with the REAL lib/deviceTrust.ts and lib/permissions.ts;
// only Google's state, cookie, token and profile steps are stubbed.
//
// Run: node scripts/test-google-signin-role-payload-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createAuthHarness } = require('./harness/load_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')

// A real Worker module, its relative imports loaded the same way, with
// `overrides` for the bindings the test owns.
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

// Google's side of the flow: a valid signed state naming the browser's
// device, a matching PKCE cookie, and a profile for `google.subject`.
function googleStub(google) {
  return {
    buildGoogleOauthStartUrl: async () => ({ success: false, error: 'not used here' }),
    exchangeGoogleOauthCode: async () => ({ success: true, tokens: { access_token: 'access-token' } }),
    getGoogleLoginOrigins: () => [],
    getGoogleLoginPublicConfig: () => ({ enabled: true }),
    getGoogleLoginRedirectUris: () => [],
    getGoogleUserFromTokens: async () => ({ success: true, user: { sub: google.subject, email: `${google.subject}@gmail.test`, emailVerified: true } }),
    matchGooglePkceVerifier: () => ({ success: true, codeVerifier: 'verifier' }),
    normalizeReturnTarget: () => ({ url: 'https://admin.example.test/login' }),
    setGooglePkceCookie: () => {},
    takeGooglePkceCookie: () => 'nonce.verifier',
    verifyState: async () => ({
      success: true,
      payload: { mode: 'login', nonce: 'nonce', returnOrigin: 'https://admin.example.test', returnPath: '/login', deviceId: google.deviceId, deviceName: 'Laptop' },
    }),
  }
}

function setup() {
  const google = { subject: '', deviceId: '' }
  let deviceTrust = null
  const h = createAuthHarness({
    overrides: {
      '../lib/googleOauth': googleStub(google),
      '../lib/deviceTrust': {
        requiresDeviceApproval: (...args) => deviceTrust.requiresDeviceApproval(...args),
        checkDeviceTrust: (...args) => deviceTrust.checkDeviceTrust(...args),
      },
    },
  })
  deviceTrust = loadTs('lib/deviceTrust.ts', { './db': { getDb: () => h.db }, './audit': { audit: async () => {} } })
  h.raw.prepare(`INSERT INTO roles (id, code, name, permissions, is_system) VALUES
    (1, 'admin', 'Administrator', '{"all":true}', 1),
    (2, 'cashier', 'Cashier', '{"pos":true,"sales":true}', 0)`).run({})
  return { h, google }
}

function addLinkedUser(h, { id, username, password, roleCode, subject }) {
  h.addUser({ id, username, name: username, password, roleCode })
  h.raw.prepare('UPDATE users SET google_subject = @subject WHERE id = @id').run({ subject, id })
}

function approveDevice(h, userId, deviceId) {
  h.raw.prepare(`INSERT INTO trusted_devices (user_id, device_id, device_name, status, decided_at)
    VALUES (@userId, @deviceId, 'Laptop', 'approved', CURRENT_TIMESTAMP)`).run({ userId, deviceId })
}

const deviceRows = (h, userId) => h.raw.prepare('SELECT device_id, status FROM trusted_devices WHERE user_id = @userId ORDER BY id').all({ userId })
  .map((row) => ({ device_id: row.device_id, status: row.status }))

async function passwordSignIn(h, username, password, deviceId) {
  return h.request('/login', 'POST', { username, password, deviceId, deviceName: 'Laptop' }, { ip: '203.0.113.5' })
}

async function googleSignIn(h, google, subject, deviceId) {
  google.subject = subject
  google.deviceId = deviceId
  const res = await h.app.request('/oauth/callback?code=auth-code&state=signed-state', {
    method: 'GET',
    headers: { 'CF-Connecting-IP': '203.0.113.5' },
  }, h.env, { waitUntil() {}, passThroughOnException() {} })
  const html = await res.text()
  const match = /const payload = (.*);\n/.exec(html)
  assert.ok(match, `the callback page carries its payload (HTTP ${res.status})`)
  return { status: res.status, payload: JSON.parse(match[1]) }
}

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
function between(source, start, end) {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
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

async function main() {
  await check('an administrator signing in with Google gets the same user as with a password, role half included', async () => {
    const { h, google } = setup()
    addLinkedUser(h, { id: 11, username: 'owner', password: 'owner-pass', roleCode: 'admin', subject: 'g-owner' })
    approveDevice(h, 11, 'dev-owner') // keeps the device gate out of this answer
    const password = await passwordSignIn(h, 'owner', 'owner-pass', 'dev-owner')
    assert.equal(password.status, 200)
    assert.equal(password.body.user.role_code, 'admin', 'control: the password answer carries the role half')
    const signedIn = await googleSignIn(h, google, 'g-owner', 'dev-owner')
    assert.equal(signedIn.status, 200)
    assert.equal(signedIn.payload.status, 'success', JSON.stringify(signedIn.payload))
    assert.deepEqual(signedIn.payload.user, password.body.user)
  })

  await check('a cashier signing in with Google gets the same user as with a password (the role half is not admin-only)', async () => {
    const { h, google } = setup()
    addLinkedUser(h, { id: 12, username: 'dara', password: 'dara-pass', roleCode: 'cashier', subject: 'g-dara' })
    approveDevice(h, 12, 'dev-till')
    const password = await passwordSignIn(h, 'dara', 'dara-pass', 'dev-till')
    assert.equal(password.status, 200)
    assert.equal(password.body.user.role_permissions, '{"pos":true,"sales":true}', 'control: the password answer carries the role grants')
    const signedIn = await googleSignIn(h, google, 'g-dara', 'dev-till')
    assert.equal(signedIn.payload.status, 'success', JSON.stringify(signedIn.payload))
    assert.deepEqual(signedIn.payload.user, password.body.user)
  })

  await check('an administrator signing in with Google on a new device is not held for approval, same as with a password', async () => {
    const { h, google } = setup()
    addLinkedUser(h, { id: 13, username: 'owner', password: 'owner-pass', roleCode: 'admin', subject: 'g-owner' })
    const password = await passwordSignIn(h, 'owner', 'owner-pass', 'dev-new-1')
    assert.equal(password.status, 200)
    assert.ok(password.body.user, 'control: a password sign-in never holds an administrator')
    const signedIn = await googleSignIn(h, google, 'g-owner', 'dev-new-2')
    assert.equal(signedIn.payload.deviceApprovalRequired, undefined, `held for approval: ${JSON.stringify(signedIn.payload)}`)
    assert.equal(signedIn.payload.status, 'success')
    assert.equal(signedIn.payload.user.role_code, 'admin')
    assert.deepEqual(deviceRows(h, 13), [], 'no pending device is recorded for an administrator')
  })

  await check('control: a cashier signing in with Google on a new device is still held for approval', async () => {
    const { h, google } = setup()
    addLinkedUser(h, { id: 14, username: 'dara', password: 'dara-pass', roleCode: 'cashier', subject: 'g-dara' })
    const password = await passwordSignIn(h, 'dara', 'dara-pass', 'dev-new-1')
    assert.equal(password.body.deviceApprovalRequired, true, 'the password sign-in is held')
    const signedIn = await googleSignIn(h, google, 'g-dara', 'dev-new-2')
    assert.equal(signedIn.payload.deviceApprovalRequired, true)
    assert.equal(signedIn.payload.deviceStatus, 'pending')
    assert.equal(signedIn.payload.user, undefined, 'no signed-in user while the device waits')
    assert.deepEqual(deviceRows(h, 14), [{ device_id: 'dev-new-1', status: 'pending' }, { device_id: 'dev-new-2', status: 'pending' }])
  })

  await check('unlinking Google answers with the same user, role half included', async () => {
    const { h } = setup()
    addLinkedUser(h, { id: 15, username: 'owner', password: 'owner-pass', roleCode: 'admin', subject: 'g-owner' })
    const password = await passwordSignIn(h, 'owner', 'owner-pass', 'dev-owner')
    const unlinked = await h.request('/oauth/unlink', 'POST', { currentPassword: 'owner-pass' }, { actorId: 15 })
    assert.equal(unlinked.status, 200, JSON.stringify(unlinked.body))
    assert.deepEqual(unlinked.body.user, password.body.user)
    assert.equal(h.userRow(15).google_subject, null, 'control: the link is gone')
  })

  await check('every sign-in answer serializes its user through buildUserPayload, which carries the role half', () => {
    const source = read('routes/auth.ts')
    const serializer = between(source, 'function buildUserPayload(', '\n}\n')
    assert.match(serializer, /role_code: user\.role_code,/)
    assert.match(serializer, /role_permissions: user\.role_permissions,/)
    const login = between(source, "app.post('/login',", "\napp.post('/logout',")
    assert.match(login, /return c\.json\(\{\n\s*success: true,\n\s*user: \{\n(?:\s*\/\/[^\n]*\n)*\s*\.\.\.buildUserPayload\(user\),/, 'POST /login')
    const otp = between(source, "app.post('/otp/verify',", '\n})\n')
    assert.match(otp, /user: \{ \.\.\.buildUserPayload\(user\)/, 'POST /otp/verify')
    const callback = between(source, "app.get('/oauth/callback',", '\n})\n')
    assert.match(callback, /provider: 'google', user: (?:\{ \.\.\.)?buildUserPayload\(synced\)/, 'Google sign-in')
  })

  if (failures.length) {
    console.log(`test-google-signin-role-payload-pure.cjs: ${failures.length} of ${passed + failures.length} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`test-google-signin-role-payload-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-google-signin-role-payload-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
