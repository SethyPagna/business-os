// Re-entering your own current password was an unlimited guessing oracle:
// anyone holding a session (a stolen cookie, an unlocked till) could try
// passwords against change-password, the self-service profile save or the
// Google unlink as fast as they liked.
//
// Drives the real routes/users.ts and routes/auth.ts handlers against the
// real lib/rateLimit.ts over in-memory SQLite (rate_limit_events as in
// migration 0004) and pins:
//   - 10 wrong current passwords, then the RIGHT one answers 429 with a code
//     (and changes nothing);
//   - wrong passwords stay 400 incorrect_password, never 401;
//   - successes do not spend the allowance (failure-only);
//   - one bucket per account, shared by change-password, profile save and
//     Google unlink; another account is unaffected;
//   - the allowance comes back when the 15-minute window passes.

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
const rateLimit = load('lib/rateLimit.ts', { './db': { getDb: (env) => env.DB }, '../index': {} })
const bcryptStub = { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` }

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
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
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
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
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
const OWNER = { id: 1, username: 'owner', name: 'Owner' }

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO users(id,username,name,password,google_subject) VALUES
    (1,'owner','Owner','hash:owner-pass',NULL),
    (2,'cashier','Cashier','hash:p0','g-cashier')`).run({})
}

const passwordOf = (id) => db.prepare('SELECT password FROM users WHERE id = @id').get({ id }).password
const googleOf = (id) => db.prepare('SELECT google_subject FROM users WHERE id = @id').get({ id }).google_subject

async function send(route, method, url, body) {
  const res = await route.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, ctx)
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
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('10 wrong current passwords on change-password, then the right one is refused with 429 and a code', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'new-pass'))
    const res = await changePassword(2, 'p0', 'new-pass')
    assert.equal(res.status, 429, res.text)
    assert.equal(res.body.code, 'current_password_rate_limited')
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

  await check('the self-service profile save misses count, stay 400, and spend the same bucket', async () => {
    actor = CASHIER
    await missTimes(10, () => saveProfile(2, 'wrong'))
    const profile = await saveProfile(2, 'p0')
    assert.equal(profile.status, 429, profile.text)
    const change = await changePassword(2, 'p0', 'p1')
    assert.equal(change.status, 429, 'change-password shares the account bucket')
  })

  await check('Google unlink misses count toward the same bucket, and are refused once over it', async () => {
    actor = CASHIER
    for (let i = 0; i < 10; i += 1) {
      const res = await unlinkGoogle('wrong')
      assert.equal(res.status, 403, res.text)
      assert.notEqual(res.status, 401)
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

  await check('the bucket is per account: one user locked out does not touch another', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'x'))
    actor = OWNER
    const res = await changePassword(1, 'owner-pass', 'owner-new')
    assert.equal(res.status, 200, res.text)
  })

  await check('the allowance returns after the 15-minute window', async () => {
    actor = CASHIER
    await missTimes(10, () => changePassword(2, 'wrong', 'x'))
    assert.equal((await changePassword(2, 'p0', 'p1')).status, 429)
    const realNow = Date.now
    Date.now = () => realNow() + 15 * 60 * 1000 + 1000
    try {
      const res = await changePassword(2, 'p0', 'p1')
      assert.equal(res.status, 200, res.text)
    } finally {
      Date.now = realNow
    }
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
