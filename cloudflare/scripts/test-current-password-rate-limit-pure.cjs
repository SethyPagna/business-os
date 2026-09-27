// Re-entering the current password must not be a guessing oracle, and the
// limit on it must not be a lockout weapon either.
//
// Drives the real routes/users.ts and routes/auth.ts handlers through the
// real lib/currentPasswordGuard.ts and lib/rateLimit.ts over in-memory SQLite
// (rate_limit_events as in migration 0004), with real session cookies, and
// pins:
//   - 10 wrong current passwords from one session, then the RIGHT one answers
//     429 with a code (and changes nothing); wrong ones stay 400, never 401;
//   - successes do not spend the allowance (failure-only);
//   - change-password, profile save and Google unlink share one allowance
//     per session;
//   - a burst of 40 PARALLEL wrong guesses admits at most the allowance
//     (refuter X3: peek-then-record let every one of them through);
//   - nobody else can lock you out (refuter X5): another session's misses,
//     or an admin's misses on your profile, leave your own session's
//     allowance whole;
//   - the window is 15 minutes: still refused at 14, open again after 15.

const assert = require('node:assert/strict')
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
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    phone TEXT, phone_lookup TEXT, phone_verified INTEGER DEFAULT 0,
    email TEXT, email_verified INTEGER DEFAULT 0, avatar_path TEXT,
    organization_id INTEGER, permissions TEXT DEFAULT '{}', role_id INTEGER, is_active INTEGER DEFAULT 1,
    deleted_at TEXT, updated_at TEXT,
    google_subject TEXT, google_email TEXT, google_email_verified INTEGER DEFAULT 0, google_linked_at TEXT
  );
  CREATE TABLE rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket TEXT NOT NULL,
    client_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`

const noop = async () => {}
// lib/db.ts answers run() with { changes }; the harness answers D1's raw
// { meta: { changes } }. rateLimit.ts reads `.changes` (same adapter as
// harness/load_auth_route.cjs). Every call is async, as on D1, so a parallel
// burst genuinely interleaves between the reserve and the compare.
const rateLimitDb = (raw) => ({
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
})
const rateLimit = load('lib/rateLimit.ts', { './db': { getDb: (env) => rateLimitDb(env.DB) }, '../index': {} })
const bcryptStub = { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` }
const guardPath = path.join(__dirname, '..', 'src', 'lib', 'currentPasswordGuard.ts')
// The cookies here are bare strings with no user_sessions row, so the sign-in
// family lookup finds nothing and the guard keys per cookie -- each cookie
// stands for one sign-in. Families across minted sessions are pinned by
// test-migration-0201-session-limit-family-pure.cjs against the real lib/auth.ts.
const authLibStub = { currentSessionLimitFamily: async () => null }
const guard = fs.existsSync(guardPath)
  ? load('lib/currentPasswordGuard.ts', { './rateLimit': rateLimit, './auth': authLibStub, bcryptjs: bcryptStub, 'hono/cookie': require('hono/cookie'), '../index': {} })
  : {}

let db
let actor
const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: bcryptStub,
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() }, revokeUserSessions: noop },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: noop },
  '../lib/permissions': { isAdminControlUser: (u) => u?.isAdmin === true },
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': guard,
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  bcryptjs: bcryptStub,
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': {
    createSession: async () => ({ token: 't', expiresAt: new Date(Date.now() + 1e6).toISOString() }),
    setSessionCookie: () => {}, clearSessionCookie: () => {}, hasSessionCookie: () => false,
    revokeSession: noop, revokeUserSessions: noop,
    getSessionUser: async () => actor,
    requireAuth: async (c, next) => { c.set('user', actor); return next() },
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
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': guard,
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': { recordFailedLogin: noop, getLoginLockoutState: async () => ({ locked: false }), clearLoginLockout: noop },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': {},
  '../index': {},
}).default

const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier' }
const OWNER = { id: 1, username: 'owner', name: 'Owner', isAdmin: true }

// The session the request comes from. Tests switch it to model a second
// device (or a stolen cookie) of the same account.
let session = 'cashier-till-session'

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO users(id,username,name,password,google_subject) VALUES
    (1,'owner','Owner','hash:owner-pass',NULL),
    (2,'cashier','Cashier','hash:p0','g-cashier')`).run({})
  session = 'cashier-till-session'
}

const passwordOf = (id) => db.prepare('SELECT password FROM users WHERE id = @id').get({ id }).password
const googleOf = (id) => db.prepare('SELECT google_subject FROM users WHERE id = @id').get({ id }).google_subject

async function send(route, method, url, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (session) headers.Cookie = `bos_session=${session}`
  const res = await route.request(url, { method, headers, body: JSON.stringify(body) }, { DB: db }, ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { status: res.status, body: json, text }
}
const changePassword = (id, currentPassword, newPassword) => send(usersRoute, 'POST', `/users/${id}/change-password`, { currentPassword, newPassword })
const saveProfile = (id, currentPassword) => send(usersRoute, 'PUT', `/users/${id}/profile`, { username: 'cashier', name: 'Cashier', currentPassword })
const unlinkGoogle = (currentPassword) => send(authRoute, 'POST', '/oauth/unlink', { currentPassword })

async function missTimes(n, fn) {
  for (let i = 0; i < n; i += 1) {
    const res = await fn(i)
    assert.equal(res.status, 400, `miss ${i + 1}: ${res.text}`)
    assert.equal(res.body.code, 'incorrect_password')
  }
}

let failures = 0
async function check(name, fn) {
  const realNow = Date.now
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) } finally { Date.now = realNow }
}

;(async () => {
  await check('10 wrong current passwords on change-password, then the right one is refused with 429 and a code', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'new-pass'))
    const res = await changePassword(2, 'p0', 'new-pass')
    assert.equal(res.status, 429, res.text)
    assert.equal(res.body.code, 'current_password_rate_limited')
    assert.ok(Number(res.body.retryAfterSeconds) > 0, 'carries retryAfterSeconds')
    assert.equal(passwordOf(2), 'hash:p0', 'nothing changed')
  })

  await check('control: 9 wrong passwords still leave the right one working', async () => {
    actor = CASHIER
    await missTimes(9, () => changePassword(2, 'wrong', 'new-pass'))
    const res = await changePassword(2, 'p0', 'p1')
    assert.equal(res.status, 200, res.text)
    assert.equal(passwordOf(2), 'hash:p1')
  })

  await check('successes do not spend the allowance: 15 good changes, then 9 misses, then a good one', async () => {
    actor = CASHIER
    for (let i = 0; i < 15; i += 1) {
      const res = await changePassword(2, `p${i}`, `p${i + 1}`)
      assert.equal(res.status, 200, `success ${i + 1}: ${res.text}`)
    }
    await missTimes(9, () => changePassword(2, 'wrong', 'x'))
    const res = await changePassword(2, 'p15', 'p16')
    assert.equal(res.status, 200, res.text)
  })

  await check('the self-service profile save misses count, stay 400, and spend the same allowance', async () => {
    actor = CASHIER
    await missTimes(10, () => saveProfile(2, 'wrong'))
    const profile = await saveProfile(2, 'p0')
    assert.equal(profile.status, 429, profile.text)
    assert.equal(profile.body.code, 'current_password_rate_limited')
    const change = await changePassword(2, 'p0', 'p1')
    assert.equal(change.status, 429, 'change-password shares the allowance')
  })

  await check('Google unlink misses count toward the same allowance, and are refused once over it', async () => {
    actor = CASHIER
    for (let i = 0; i < 10; i += 1) {
      const res = await unlinkGoogle('wrong')
      assert.equal(res.status, 403, res.text)
    }
    const unlink = await unlinkGoogle('p0')
    assert.equal(unlink.status, 429, unlink.text)
    assert.equal(unlink.body.code, 'current_password_rate_limited')
    assert.equal(googleOf(2), 'g-cashier', 'still linked')
    assert.equal((await changePassword(2, 'p0', 'p1')).status, 429)
  })

  await check('control: unlink with the right password inside the allowance works', async () => {
    actor = CASHIER
    await missTimes(9, () => changePassword(2, 'wrong', 'x'))
    const unlink = await unlinkGoogle('p0')
    assert.equal(unlink.status, 200, unlink.text)
    assert.equal(googleOf(2), null)
  })

  await check('X3: a burst of 40 parallel wrong guesses admits at most 10 compares', async () => {
    actor = CASHIER
    const results = await Promise.all(Array.from({ length: 40 }, () => changePassword(2, 'wrong', 'x')))
    const compared = results.filter((r) => r.status === 400).length
    const refused = results.filter((r) => r.status === 429).length
    assert.ok(compared <= 10, `the burst got ${compared} password compares; the allowance is 10`)
    assert.equal(compared + refused, 40, results.map((r) => r.status).join(','))
    const right = await changePassword(2, 'p0', 'p1')
    assert.equal(right.status, 429, 'the allowance is spent after the burst')
    assert.equal(passwordOf(2), 'hash:p0')
  })

  await check('X3: a parallel burst of RIGHT passwords is not refused and leaves nothing counted', async () => {
    actor = CASHIER
    const results = await Promise.all(Array.from({ length: 5 }, () => changePassword(2, 'p0', 'p0')))
    for (const r of results) assert.equal(r.status, 200, r.text)
    await missTimes(9, () => changePassword(2, 'wrong', 'x'))
    assert.equal((await changePassword(2, 'p0', 'p1')).status, 200)
  })

  await check('X5: another session of the same account exhausting its allowance does not lock this session out', async () => {
    actor = CASHIER
    session = 'stolen-or-other-device'
    await missTimes(10, () => changePassword(2, 'wrong', 'x'))
    assert.equal((await changePassword(2, 'p0', 'p1')).status, 429, 'the guessing session is itself limited')
    session = 'cashier-till-session'
    const own = await changePassword(2, 'p0', 'p1')
    assert.equal(own.status, 200, own.text)
    assert.equal(passwordOf(2), 'hash:p1')
  })

  await check('X5: an admin guessing on your profile exhausts only their own allowance against you', async () => {
    actor = OWNER
    session = 'owner-session'
    await missTimes(10, () => saveProfile(2, 'wrong'))
    const adminAgain = await saveProfile(2, 'p0')
    assert.equal(adminAgain.status, 429, 'the admin is limited against this target')
    actor = CASHIER
    session = 'cashier-till-session'
    const own = await changePassword(2, 'p0', 'p1')
    assert.equal(own.status, 200, own.text)
  })

  await check('the bucket is per account: one user locked out does not touch another', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'x'))
    actor = OWNER
    session = 'owner-session'
    const res = await changePassword(1, 'owner-pass', 'owner-new')
    assert.equal(res.status, 200, res.text)
  })

  await check('the window is 15 minutes: still refused at 14, open again after 15', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'x'))
    assert.equal((await changePassword(2, 'p0', 'p1')).status, 429)
    const realNow = Date.now
    Date.now = () => realNow() + 14 * 60 * 1000
    const at14 = await changePassword(2, 'p0', 'p1')
    assert.equal(at14.status, 429, `still inside the window at 14 minutes: ${at14.text}`)
    Date.now = () => realNow() + 15 * 60 * 1000 + 1000
    const after = await changePassword(2, 'p0', 'p1')
    assert.equal(after.status, 200, after.text)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
