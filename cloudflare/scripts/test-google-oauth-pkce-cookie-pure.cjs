// The Google sign-in PKCE code_verifier used to travel INSIDE the signed
// `state`, which is URL-visible: Google's consent URL, the callback URL,
// browser history and any proxy log held both the authorization code and the
// verifier that redeems it, so PKCE protected nothing.
//
// Part A drives the real lib/googleOauth.ts start builder:
//   - the state carries a nonce and NO verifier;
//   - the verifier is handed back separately, bound to that nonce, and is the
//     one the S256 code_challenge was computed from.
// Part B drives the real routes/auth.ts start + callback with the real
// googleOauth.ts (state signing, one-time KV record, cookie helpers); only
// Google's two network calls are stubbed. It pins:
//   - start sets an HttpOnly, Secure, SameSite=Lax, callback-scoped,
//     10-minute cookie;
//   - a callback without that cookie, or with the cookie of another flow, is
//     refused BEFORE the code is redeemed;
//   - the happy path signs in (login) or links (link), sending Google the
//     cookie's verifier;
//   - the cookie is cleared on every outcome.

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
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
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    email TEXT, email_verified INTEGER DEFAULT 0, otp_enabled INTEGER DEFAULT 0, otp_secret TEXT,
    organization_id INTEGER, role_id INTEGER, permissions TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1, deleted_at TEXT, updated_at TEXT,
    google_subject TEXT, google_email TEXT, google_email_verified INTEGER DEFAULT 0, google_linked_at TEXT
  );
`

const noop = async () => {}
const googleOauth = load('lib/googleOauth.ts', { '../index': {} })
const COOKIE = 'bos_google_pkce'

let db
let kv
let sessionsCreated
let googleCalls
let googleSubject
const sessionsByToken = { 'tok-cashier': { id: 2, username: 'cashier' } }
function sessionFromCookie(c) {
  const match = /bos_session=([^;]+)/.exec(c.req.header('Cookie') || '')
  return match ? (sessionsByToken[match[1]] || null) : null
}

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': {
    createSession: async (_env, userId) => { sessionsCreated.push(userId); return { token: 't', expiresAt: new Date(Date.now() + 1e6).toISOString() } },
    setSessionCookie: () => {}, clearSessionCookie: () => {}, hasSessionCookie: () => false,
    revokeSession: noop, revokeUserSessions: noop,
    getSessionUser: async (c) => sessionFromCookie(c),
    requireAuth: async (c, next) => {
      const user = sessionFromCookie(c)
      if (!user) return c.json({ error: 'Not authenticated' }, 401)
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
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: noop, getClientIp: () => '127.0.0.1' },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': { recordFailedLogin: noop, getLoginLockoutState: async () => ({ locked: false }), clearLoginLockout: noop },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': googleOauth,
  '../index': {},
}).default

// Google's two network steps. Everything else (state signing, the one-time
// KV record, the cookie) is the real code.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const href = String(url)
  if (href === 'https://oauth2.googleapis.com/token') {
    googleCalls.push({ kind: 'token', body: Object.fromEntries(new URLSearchParams(String(init.body))) })
    return new Response(JSON.stringify({ access_token: 'at' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (href === 'https://openidconnect.googleapis.com/v1/userinfo') {
    googleCalls.push({ kind: 'userinfo' })
    return new Response(JSON.stringify({ sub: googleSubject, email: 'cashier@gmail.com', email_verified: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return realFetch(url, init)
}

const ENV_VARS = {
  GOOGLE_LOGIN_CLIENT_ID: 'client-id',
  GOOGLE_LOGIN_CLIENT_SECRET: 'client-secret',
  GOOGLE_LOGIN_REDIRECT_URI: 'https://admin.example.com/api/auth/oauth/callback',
  AUTH_SESSION_SECRET: 'state-secret',
  BUSINESS_OS_ADMIN_URL: 'https://admin.example.com',
  BUSINESS_OS_PUBLIC_URL: 'https://example.com',
}
const env = () => ({
  ...ENV_VARS,
  DB: db,
  CACHE: {
    async put(key, value) { kv.set(key, value) },
    async get(key) { return kv.get(key) || null },
    async delete(key) { kv.delete(key) },
  },
})
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

function reset() {
  db = openDb([SCHEMA])
  kv = new Map()
  sessionsCreated = []
  googleCalls = []
  googleSubject = 'g-cashier'
  db.prepare(`INSERT INTO users(id,username,name,password,google_subject) VALUES
    (1,'owner','Owner','hash:owner-pass',NULL),
    (2,'cashier','Cashier','hash:cashier-pass',NULL),
    (3,'linked','Linked','hash:x','g-cashier')`).run({})
}

const decodeState = (state) => JSON.parse(Buffer.from(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
const s256 = (value) => crypto.createHash('sha256').update(value).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const setCookies = (res) => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean))
const pkceSetCookie = (res) => setCookies(res).find((line) => line.startsWith(`${COOKIE}=`)) || null

async function start(mode, sessionToken) {
  const headers = { 'Content-Type': 'application/json' }
  if (sessionToken) headers.Cookie = `bos_session=${sessionToken}`
  const res = await authRoute.request('/oauth/start', { method: 'POST', headers, body: JSON.stringify({ mode }) }, env(), ctx)
  const body = await res.json()
  const state = body.url ? new URL(body.url).searchParams.get('state') : null
  const line = pkceSetCookie(res)
  const value = line ? line.split(';')[0].slice(COOKIE.length + 1) : null
  return { status: res.status, body, state, cookieLine: line, cookieValue: value }
}

async function callback(state, { pkce, session } = {}) {
  const cookies = []
  if (pkce) cookies.push(`${COOKIE}=${pkce}`)
  if (session) cookies.push(`bos_session=${session}`)
  const headers = cookies.length ? { Cookie: cookies.join('; ') } : {}
  const res = await authRoute.request(`/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`, { headers }, env(), ctx)
  return { status: res.status, html: await res.text(), cleared: pkceSetCookie(res) }
}

function assertCleared(line) {
  assert.ok(line, 'the callback response must clear the PKCE cookie')
  assert.match(line, /Max-Age=0/i)
  assert.match(line, /Path=\/api\/auth\/oauth\/callback/)
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  // Part A ------------------------------------------------------------------
  await check('the signed state carries a nonce and no verifier; the verifier comes back separately, bound to it', async () => {
    const result = await googleOauth.buildGoogleOauthStartUrl(env(), { mode: 'login' })
    assert.equal(result.success, true, result.error)
    const url = new URL(result.url)
    const state = url.searchParams.get('state')
    const payload = decodeState(state)
    assert.equal('codeVerifier' in payload, false, 'no codeVerifier field in state')
    assert.ok(payload.nonce, 'state carries a nonce')
    assert.equal(typeof result.pkceBinding, 'string', 'the verifier is handed back outside the URL')
    const [nonce, verifier] = result.pkceBinding.split('.')
    assert.equal(nonce, payload.nonce, 'the binding names this flow')
    assert.ok(verifier && verifier.length >= 43, 'a real verifier')
    assert.equal(url.searchParams.get('code_challenge'), s256(verifier), 'the challenge is the S256 of THIS verifier')
    assert.equal(result.url.includes(verifier), false, 'the verifier appears nowhere in the consent URL')
    assert.equal(JSON.stringify(payload).includes(verifier), false)
  })

  // Part B ------------------------------------------------------------------
  await check('start sets an HttpOnly, Secure, SameSite=Lax, callback-scoped, 10-minute PKCE cookie', async () => {
    const started = await start('login')
    assert.equal(started.status, 200, JSON.stringify(started.body))
    assert.ok(started.cookieLine, 'Set-Cookie bos_google_pkce missing')
    assert.match(started.cookieLine, /HttpOnly/i)
    assert.match(started.cookieLine, /Secure/i)
    assert.match(started.cookieLine, /SameSite=Lax/i)
    assert.match(started.cookieLine, /Path=\/api\/auth\/oauth\/callback/)
    assert.match(started.cookieLine, /Max-Age=600\b/)
    assert.equal(decodeURIComponent(started.cookieValue).split('.')[0], decodeState(started.state).nonce)
    assert.equal(started.state.includes(decodeURIComponent(started.cookieValue).split('.')[1]), false)
  })

  await check('happy path (login): the cookie\'s verifier reaches Google and the linked account signs in', async () => {
    const started = await start('login')
    const done = await callback(started.state, { pkce: started.cookieValue })
    assert.equal(done.status, 200, done.html)
    assert.match(done.html, /Google sign-in complete/)
    const token = googleCalls.find((call) => call.kind === 'token')
    assert.ok(token, 'the code was redeemed')
    assert.equal(token.body.code_verifier, decodeURIComponent(started.cookieValue).split('.')[1])
    assert.deepEqual(sessionsCreated, [3])
    assertCleared(done.cleared)
  })

  await check('a callback WITHOUT the cookie is refused and the code is never redeemed', async () => {
    const started = await start('login')
    const done = await callback(started.state, {})
    assert.equal(done.status, 400)
    assert.match(done.html, /did not start this Google sign-in/)
    assert.deepEqual(googleCalls, [], 'no token exchange')
    assert.deepEqual(sessionsCreated, [])
    assertCleared(done.cleared)
  })

  await check('a cookie from ANOTHER flow (nonce mismatch) is refused and the code is never redeemed', async () => {
    const first = await start('login')
    const second = await start('login')
    const done = await callback(second.state, { pkce: first.cookieValue })
    assert.equal(done.status, 400)
    assert.match(done.html, /could not be matched to this browser/)
    assert.deepEqual(googleCalls, [])
    assert.deepEqual(sessionsCreated, [])
    assertCleared(done.cleared)
  })

  await check('a tampered cookie (right nonce, extra segment) is refused', async () => {
    const started = await start('login')
    const done = await callback(started.state, { pkce: `${started.cookieValue}.x` })
    assert.equal(done.status, 400)
    assert.deepEqual(googleCalls, [])
  })

  await check('an invalid state still clears the cookie', async () => {
    const started = await start('login')
    const done = await callback(`${started.state}x`, { pkce: started.cookieValue })
    assert.equal(done.status, 400)
    assert.deepEqual(googleCalls, [])
    assertCleared(done.cleared)
  })

  await check('happy path (link): the same cookie binding completes a link for the signed-in user', async () => {
    googleSubject = 'g-new'
    const started = await start('link', 'tok-cashier')
    assert.equal(started.status, 200, JSON.stringify(started.body))
    assert.ok(started.cookieLine, 'link start sets the PKCE cookie too')
    assert.equal('codeVerifier' in decodeState(started.state), false)
    const done = await callback(started.state, { pkce: started.cookieValue, session: 'tok-cashier' })
    assert.equal(done.status, 200, done.html)
    assert.equal(db.prepare('SELECT google_subject FROM users WHERE id = 2').get({}).google_subject, 'g-new')
    assertCleared(done.cleared)
  })

  await check('link without the cookie is refused even for the signed-in user', async () => {
    googleSubject = 'g-new'
    const started = await start('link', 'tok-cashier')
    const done = await callback(started.state, { session: 'tok-cashier' })
    assert.equal(done.status, 400)
    assert.deepEqual(googleCalls, [])
    assert.equal(db.prepare('SELECT google_subject FROM users WHERE id = 2').get({}).google_subject, null)
  })

  globalThis.fetch = realFetch
  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
