// My Profile's "Connect Google" could never appear: GET /users/:id/auth-methods
// was a hard-coded stub (google_ready false, google_connected false, while the
// profile reads google_linked). The real link flow lives in routes/auth.ts.
//
// Part A drives the real routes/users.ts auth-methods with the real
// lib/googleOauth.ts readiness rule over in-memory SQLite.
// Part B drives the real routes/auth.ts OAuth callback (mode: 'link') and
// unlink route with Google's network steps stubbed, and pins:
//   - the link lands on the user named in the signed state ONLY when the
//     browser finishing it is signed in as that same user (no session, or a
//     different signed-in user, is refused and records nothing);
//   - a Google identity already linked to another user is refused;
//   - unlink needs the current password.
// S-auth4e: STARTING a link needs the current password too (a borrowed or
// stolen session must not be able to attach the thief's Google account for
// lasting access), and an account that must change a publicly known
// password (S-auth4b) cannot start or finish a link at all.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { passwordHashStub, failedSignInCostStub } = require('./harness/password_hash_stub.cjs')
const { credentialGuardPassThrough } = require('./harness/credential_guard_stub.cjs')
const { openDb } = require('./harness/d1compat.cjs')

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

const SCHEMA = `
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    email TEXT, email_verified INTEGER DEFAULT 0, otp_enabled INTEGER DEFAULT 0, otp_secret TEXT,
    organization_id INTEGER, role_id INTEGER, permissions TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1, deleted_at TEXT, updated_at TEXT,
    google_subject TEXT, google_email TEXT, google_email_verified INTEGER DEFAULT 0, google_linked_at TEXT
  );
`

let db
let actor
const googleOauth = load('lib/googleOauth.ts')
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  // The last-administrator guard is proven by test-last-admin-guard-pure.cjs; this fixture has no admin rows.
  '../lib/adminControlGuard': { planAdminControlWrite: async () => ({ guard: { sql: 'SELECT 1', params: {} } }), isAdminControlGuardAbort: () => false, lastAdminRequiredBody: () => ({}) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() }, revokeUserSessions: noop },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: noop },
  '../lib/permissions': { isAdminControlUser: (u) => u?.isAdmin === true },
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {}, getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/googleOauth': googleOauth,
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

// Google's side of the round trip, stubbed: the state verifies to a link
// started by `stateUserId`, and the consent returns `googleUser`.
let stateUserId
let googleUser
const sessionsByToken = { 'tok-owner': { id: 1, username: 'owner' }, 'tok-cashier': { id: 2, username: 'cashier' }, 'tok-flagged': { id: 2, username: 'cashier', must_change_password: 1 } }
function sessionFromCookie(c) {
  const match = /bos_session=([^;]+)/.exec(c.req.header('Cookie') || '')
  return match ? (sessionsByToken[match[1]] || null) : null
}
const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/failedSignInCost': failedSignInCostStub,
  '../lib/requestBodyGuard': credentialGuardPassThrough,
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': {
    createSession: async () => ({ token: 't', expiresAt: new Date(Date.now() + 1e6).toISOString() }),
    setSessionCookie: () => {}, clearSessionCookie: () => {}, hasSessionCookie: () => false,
    revokeSession: noop, revokeUserSessions: noop,
    getSessionUser: async (c) => sessionFromCookie(c),
    requireAuth: async (c, next) => {
      const user = sessionFromCookie(c)
      if (!user) return c.json({ error: 'Not authenticated', code: 'invalid_session' }, 401)
      c.set('user', user)
      return next()
    },
  },
  '../lib/verification': {
    issuePasswordResetLink: noop, consumePasswordResetLink: noop, isEmailConfigured: () => false,
    normalizeEmail: (v) => String(v || '').trim().toLowerCase(),
  },
  '../lib/audit': { audit: noop },
  '../lib/secretCrypto': { encryptSecret: async (v) => v, decryptSecret: async (v) => v },
  '../lib/totp': { generateTotpSecret: () => 'S', verifyTotp: async () => false },
  '../lib/permissions': { isAdminControlUser: () => false },
  '../lib/planTier': { resolvePlanTier: () => 'pro' },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {}, getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': { recordFailedLogin: noop, getLoginLockoutState: async () => ({ locked: false }), clearLoginLockout: noop },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': {
    ...googleOauth,
    verifyState: async () => ({ success: true, payload: { provider: 'google', mode: 'link', currentUserId: stateUserId, nonce: 'n1', returnOrigin: 'https://admin.example', returnPath: '/profile' } }),
    exchangeGoogleOauthCode: async () => ({ success: true, tokens: {} }),
    getGoogleUserFromTokens: async () => ({ success: true, user: googleUser }),
    normalizeReturnTarget: () => ({ origin: 'https://admin.example', path: '/profile', url: 'https://admin.example/profile' }),
  },
  '../index': {},
}).default

const READY_ENV = {
  GOOGLE_LOGIN_CLIENT_ID: 'client-id', GOOGLE_LOGIN_CLIENT_SECRET: 'client-secret',
  AUTH_SESSION_SECRET: 'state-secret', GOOGLE_LOGIN_REDIRECT_URI: 'https://admin.example/api/auth/oauth/callback',
}

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO users(id,username,name,password,email) VALUES
    (1,'owner','Owner','hash:owner-pass',@owner_email),
    (2,'cashier','Cashier','hash:cashier-pass',NULL),
    (3,'manager','Manager','hash:manager-pass',NULL)`).run({ owner_email: 'owner@example.com' })
  db.prepare("UPDATE users SET google_subject = 'g-manager', google_email = @email, google_linked_at = '2026-09-01 00:00:00' WHERE id = 3").run({ email: 'm@gmail.com' })
  stateUserId = 2
  googleUser = { sub: 'g-cashier', email: 'cashier@gmail.com', emailVerified: true }
}

const googleSubjectOf = (id) => db.prepare('SELECT google_subject FROM users WHERE id = @id').get({ id }).google_subject

async function callback(cookieToken) {
  // The browser that started the link also holds its PKCE cookie (bound to
  // the state's nonce) -- see test-google-oauth-pkce-cookie-pure.cjs.
  const cookies = ['bos_google_pkce=n1.test-verifier']
  if (cookieToken) cookies.push(`bos_session=${cookieToken}`)
  const headers = { Cookie: cookies.join('; ') }
  const res = await authRoute.request('/oauth/callback?code=c&state=s', { headers }, { ...READY_ENV, DB: db }, ctx)
  return { status: res.status, html: await res.text() }
}

async function authMethods(id, env) {
  const res = await usersRoute.request(`/users/${id}/auth-methods`, {}, { ...env, DB: db }, ctx)
  return { status: res.status, body: await res.json() }
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  // Part A ------------------------------------------------------------------
  await check('auth-methods reports a stored Google link as google_linked (the field the profile reads)', async () => {
    actor = { id: 3, username: 'manager' }
    const { status, body } = await authMethods(3, READY_ENV)
    assert.equal(status, 200)
    assert.equal(body.google_linked, true)
    assert.equal(body.google_email, 'm@gmail.com')
    assert.deepEqual(body.linked_providers, ['google'])
  })

  await check('auth-methods reports an unlinked account as not linked', async () => {
    actor = { id: 2, username: 'cashier' }
    const { body } = await authMethods(2, READY_ENV)
    assert.equal(body.google_linked, false)
    assert.equal(body.google_email, '')
  })

  await check('google_ready is true only when client id, client secret, state secret and redirect are all configured', async () => {
    actor = { id: 2, username: 'cashier' }
    assert.equal((await authMethods(2, READY_ENV)).body.google_ready, true)
    const { GOOGLE_LOGIN_CLIENT_SECRET: _s, ...noSecret } = READY_ENV
    // AUTH_SESSION_SECRET still signs state, but the code exchange needs the client secret.
    assert.equal((await authMethods(2, noSecret)).body.google_ready, false)
    assert.equal((await authMethods(2, {})).body.google_ready, false)
    // U-profile3 (refuter M6): everything but a redirect URI -- none
    // configured and no app origin to derive one from -- is NOT ready: the
    // consent URL could not name where Google sends the user back.
    const { GOOGLE_LOGIN_REDIRECT_URI: _r, ...noRedirect } = READY_ENV
    assert.equal((await authMethods(2, noRedirect)).body.google_ready, false, 'no redirect URI, not ready')
    // Control: a derivable redirect (the admin origin) is enough.
    assert.equal((await authMethods(2, { ...noRedirect, BUSINESS_OS_ADMIN_URL: 'https://admin.example' })).body.google_ready, true)
  })

  await check('auth-methods of another user stays refused for a non-admin', async () => {
    actor = { id: 2, username: 'cashier' }
    assert.equal((await authMethods(3, READY_ENV)).status, 403)
  })

  // Part B ------------------------------------------------------------------
  await check('link completes onto the signed-in user named in the state', async () => {
    const { status } = await callback('tok-cashier')
    assert.equal(status, 200)
    assert.equal(googleSubjectOf(2), 'g-cashier')
  })

  await check('link is refused when the finishing browser has no session', async () => {
    const { status, html } = await callback(null)
    assert.equal(status, 400)
    assert.match(html, /Sign in to Leang Cosmetics Admin in this browser/)
    assert.equal(googleSubjectOf(2), null)
  })

  await check('link is refused when a DIFFERENT user is signed in where it finishes', async () => {
    const { status } = await callback('tok-owner')
    assert.equal(status, 400)
    assert.equal(googleSubjectOf(2), null, 'the state user gets nothing')
    assert.equal(googleSubjectOf(1), null, 'the signed-in user gets nothing either')
  })

  await check('a Google identity already linked to another user is refused', async () => {
    googleUser = { sub: 'g-manager', email: 'm@gmail.com', emailVerified: true }
    const { status, html } = await callback('tok-cashier')
    assert.equal(status, 400)
    assert.match(html, /already linked to another user/)
    assert.equal(googleSubjectOf(2), null)
    assert.equal(googleSubjectOf(3), 'g-manager')
  })

  await check('unlink needs the current password, then clears the link', async () => {
    db.prepare("UPDATE users SET google_subject = 'g-cashier', google_email = @email WHERE id = 2").run({ email: 'c@gmail.com' })
    const unlink = (password) => authRoute.request('/oauth/unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'bos_session=tok-cashier' },
      body: JSON.stringify({ currentPassword: password }),
    }, { ...READY_ENV, DB: db }, ctx)
    const wrong = await unlink('nope')
    assert.notEqual(wrong.status, 200)
    assert.notEqual(wrong.status, 401, 'a wrong password must not look like a dead session')
    assert.equal(googleSubjectOf(2), 'g-cashier')
    const right = await unlink('cashier-pass')
    assert.equal(right.status, 200, await right.text())
    assert.equal(googleSubjectOf(2), null)
  })

  // S-auth4e ------------------------------------------------------------------
  const kv = new Map()
  const startEnv = () => ({
    ...READY_ENV, DB: db,
    BUSINESS_OS_ADMIN_URL: 'https://admin.example', BUSINESS_OS_PUBLIC_URL: 'https://example.com',
    CACHE: { async put(k, v) { kv.set(k, v) }, async get(k) { return kv.get(k) || null }, async delete(k) { kv.delete(k) } },
  })
  const start = (cookieToken, body) => authRoute.request('/oauth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookieToken ? { Cookie: `bos_session=${cookieToken}` } : {}) },
    body: JSON.stringify({ provider: 'google', mode: 'link', redirectTo: 'https://admin.example/profile', ...body }),
  }, startEnv(), ctx)

  await check('starting a link without the current password is refused and sets no PKCE cookie', async () => {
    const res = await start('tok-cashier', {})
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.url, undefined, 'no consent URL')
    assert.equal(body.code, 'current_password_required')
    assert.doesNotMatch(res.headers.get('set-cookie') || '', /bos_google_pkce/)
  })

  await check('starting a link with a wrong current password is refused', async () => {
    const res = await start('tok-cashier', { currentPassword: 'nope' })
    assert.equal(res.status, 403)
    assert.equal((await res.json()).url, undefined)
  })

  await check('starting a link with the right current password returns the consent URL', async () => {
    const res = await start('tok-cashier', { currentPassword: 'cashier-pass' })
    assert.equal(res.status, 200, await res.clone().text())
    assert.match((await res.json()).url, /^https:\/\/accounts\.google\.com\//)
  })

  await check('an account that must change its password cannot start a link, even with it', async () => {
    const res = await start('tok-flagged', { currentPassword: 'cashier-pass' })
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.code, 'password_change_required')
    assert.equal(body.url, undefined)
  })

  await check('an account that must change its password cannot finish a link', async () => {
    const { status } = await callback('tok-flagged')
    assert.equal(status, 400)
    assert.equal(googleSubjectOf(2), null)
  })

  await check('control: Google sign-in (login mode) needs no password or session', async () => {
    const res = await authRoute.request('/oauth/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', mode: 'login', redirectTo: 'https://admin.example/' }),
    }, startEnv(), ctx)
    assert.equal(res.status, 200, await res.clone().text())
    assert.ok((await res.json()).url)
  })

  await check('the Google return pages name the staff app as the owner named it (28 Sep: Leang Cosmetics Admin)', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8')
    assert.doesNotMatch(source, /Business OS/)
    assert.match(source, /const ADMIN_APP_NAME = 'Leang Cosmetics Admin'/)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
