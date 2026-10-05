// S-auth4b: a publicly known password (in git history) forces a change, and
// no staff password writer will set one.
//
// Drives the REAL routes/auth.ts POST /login and reset routes, the REAL
// routes/users.ts create / change / admin reset, the REAL lib/auth.ts session
// lookup + requireAuth gate and the REAL lib/passwordPolicy.ts, over
// in-memory SQLite with migration 0202 applied from its file and real
// Set-Cookie sessions.
//
// Pins:
//   - 0202 is LF-only and additive: existing users read 0;
//   - signing in with 'Admin123456!' succeeds but marks the account; every
//     requireAuth route then answers 403 password_change_required, except the
//     self change-password; a known password is refused there too; a fresh
//     one clears the flag and the account works again;
//   - control: signing in with an ordinary password marks nothing;
//   - 'admin123' is refused outside local dev and tolerated in local dev
//     (BUSINESS_OS_LOCAL_DEV=1 on an unstamped build); 'Admin123456!' never;
//   - every writer refuses a known password: user create, self change, admin
//     reset, email-link reset, authenticator-code reset;
//   - the plaintext never reaches console output or the audit log;
//   - owner requirement (27 Sep 2026), no closed loop: the app's sign-out
//     probe (the path read from frontend/src/api/http.ts) answers for a
//     must-change account, so Sign out finishes; a reload reads the flag from
//     /bootstrap; a wrong current password is 400 then the usual 429 limit,
//     the session and the flag untouched; old -> new needs no rule beyond
//     length and not publicly known; the new password signs in unflagged;
//   - before 0202 is applied (no column) sign-in still works: the lookup falls
//     back and nothing 500s.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { passwordHashStub } = require('./harness/password_hash_stub.cjs')
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

// FX-sec (claude/fx-sec-20260927), which merges before this lane, adds
// lib/adminControlGuard.ts and routes/users.ts imports it. Where the file
// exists it is loaded REAL, over the same permissions the route is given; on
// a tree without it nothing asks for it and this adds no entry.
const withAdminControlGuard = (permissions) => ({
  '../lib/permissions': permissions,
  ...(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'adminControlGuard.ts'))
    ? { '../lib/adminControlGuard': load('lib/adminControlGuard.ts', { './permissions': permissions }) }
    : {}),
})

const MIGRATION_0202 = path.join(__dirname, '..', 'migrations', '0202_users_must_change_password.sql')
// Before the fix there is no 0202 file; the column alone changes nothing in
// the old code, so the test still runs there and fails on BEHAVIOUR.
const MIGRATION_SQL = fs.existsSync(MIGRATION_0202)
  ? fs.readFileSync(MIGRATION_0202, 'utf8')
  : 'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;'
const LEAKED = 'Admin123456!'

const SCHEMA = `
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    phone TEXT, phone_lookup TEXT, phone_verified INTEGER DEFAULT 0,
    email TEXT, email_verified INTEGER DEFAULT 0, avatar_path TEXT,
    organization_id INTEGER, permissions TEXT DEFAULT '{}', role_id INTEGER, is_active INTEGER DEFAULT 1,
    deleted_at TEXT, updated_at TEXT, otp_enabled INTEGER DEFAULT 0, otp_secret TEXT,
    google_subject TEXT, google_email TEXT, google_email_verified INTEGER DEFAULT 0, google_linked_at TEXT
  );
  CREATE TABLE rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bucket TEXT NOT NULL, client_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
    device_name TEXT, device_tz TEXT, client_time TEXT, user_agent TEXT, last_ip TEXT,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, revoked_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, device_id TEXT, limit_family_id INTEGER
  );
  CREATE UNIQUE INDEX idx_user_sessions_token_hash_unique_pg ON user_sessions (token_hash);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
`

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
})
const libDb = { getDb: (env) => adapt(env.DB) }
const cookie = require('hono/cookie')
const rateLimit = load('lib/rateLimit.ts', { './db': libDb, '../index': {} })
const authLib = load('lib/auth.ts', { './db': libDb, 'hono/cookie': cookie, '../index': {} })
const policy = load('lib/passwordPolicy.ts', {})
const guardOverrides = { './rateLimit': rateLimit, './auth': authLib, './passwordHash': passwordHashStub, 'hono/cookie': cookie, '../index': {} }
const guard = load('lib/currentPasswordGuard.ts', guardOverrides)
const audits = []
// audit(env, actorId, actorName, action, entity, entityId, details): drop env.
const auditSpy = async (_env, ...args) => { audits.push(JSON.stringify(args)) }
let resetLinkConsumed = 0

const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': authLib,
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: auditSpy },
  ...withAdminControlGuard({ isAdminControlUser: (u) => Number(u?.id) === 1 }),
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': guard,
  '../lib/passwordPolicy': policy,
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

// Like D1, every statement answers with a promise: GET /bootstrap chains
// .catch() on its settings read instead of awaiting it at once. Result shapes
// are the shim's own.
const promisedDb = (raw) => ({
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return { get: async (p) => stmt.get(p), all: async (p) => stmt.all(p), run: async (p) => stmt.run(p) }
  },
})

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/db': { getDb: (env) => promisedDb(env.DB) },
  '../lib/auth': authLib,
  '../lib/verification': {
    issuePasswordResetLink: noop,
    consumePasswordResetLink: async () => { resetLinkConsumed += 1; return { ok: true, userId: 2 } },
    isEmailConfigured: () => false,
    normalizeEmail: (v) => String(v || '').trim().toLowerCase(),
  },
  '../lib/audit': { audit: auditSpy },
  '../lib/secretCrypto': { encryptSecret: async (v) => v, decryptSecret: async (v) => v },
  '../lib/totp': { generateTotpSecret: () => 'S', verifyTotp: async () => false, verifyTotpStep: async () => null },
  '../lib/permissions': { isAdminControlUser: () => false },
  '../lib/planTier': { resolvePlanTier: () => 'pro' },
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': guard,
  '../lib/passwordPolicy': policy,
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': {
    recordFailedLogin: async () => ({ locked: false, failedCount: 1 }),
    getLoginLockoutState: async () => ({ locked: false }),
    clearLoginLockout: noop,
    userIdLockoutKey: (id) => `uid:${id}`,
    perNetworkLockoutKey: (key, ip) => `${key}@${ip}`,
    worstLockoutState: (...states) => states[0] || { locked: false },
  },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': {},
  '../index': {},
}).default

const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

// The app's Sign out (frontend/src/api/http.ts recoverUnresolvedSignout) asks
// who owns the cookie before and after POST /api/auth/logout, and believes the
// sign-out only once that probe reads 401 invalid_session. Mounted the way
// index.ts mounts routes/sync.ts: a sub-app at /api/sync behind the REAL
// requireAuth.
const { Hono } = require('hono')
const FRONTEND_HTTP_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'http.ts'), 'utf8')
const SIGNOUT_PROBE_PATH = /apiFetch\('GET', '([^']+)', undefined, 8000, \{ signoutRecovery: token \}\)/.exec(FRONTEND_HTTP_SOURCE)?.[1] || null
const syncApp = new Hono()
syncApp.use('*', authLib.requireAuth)
syncApp.get('/owner', (c) => c.json({ owner: { actor_id: c.get('user').id } }))
syncApp.post('/outbox', (c) => c.json({ success: true, results: [] }))
const workerApp = new Hono()
workerApp.route('/api/sync', syncApp)
let db
let env

function reset({ migrated = true, vars = {} } = {}) {
  db = openDb([SCHEMA])
  if (migrated) db.exec(MIGRATION_SQL)
  db.exec(`INSERT INTO users(id,username,name,password,email) VALUES
    (1,'admin','Admin','hash:admin-strong-1',NULL),
    (2,'owner','Owner','hash:${LEAKED}','owner@example.com'),
    (3,'cashier','Cashier','hash:till-pass-3',NULL),
    (4,'demo','Demo','hash:admin123',NULL)`)
  env = { DB: db, ...vars }
  audits.length = 0
  resetLinkConsumed = 0
}

async function send(route, method, url, token, body) {
  const headers = { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }
  if (token) headers.Cookie = `bos_session=${token}`
  const init = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await route.request(url, init, env, ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  const minted = /bos_session=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1] || null
  return { status: res.status, body: json, text, minted }
}

async function login(username, password) {
  const res = await send(authRoute, 'POST', '/login', null, { username, password, deviceId: 'dev-1' })
  assert.equal(res.status, 200, `login ${username}: ${res.text}`)
  assert.ok(res.minted, 'a session cookie was issued')
  return res
}
const flagOf = (id) => db.prepare('SELECT must_change_password AS f FROM users WHERE id = @id').get({ id }).f
const passwordOf = (id) => db.prepare('SELECT password FROM users WHERE id = @id').get({ id }).password
const changePassword = (token, id, currentPassword, newPassword) =>
  send(usersRoute, 'POST', `/users/${id}/change-password`, token, { currentPassword, newPassword })
// Any ordinary requireAuth route stands for "the rest of the API".
const someProtectedCall = (token) => send(authRoute, 'POST', '/session-duration', token, { sessionDuration: '7d' })

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('0202: LF-only, one additive column, every existing user reads 0', async () => {
    assert.ok(fs.existsSync(MIGRATION_0202), 'migration 0202 exists')
    const text = fs.readFileSync(MIGRATION_0202, 'utf8')
    assert.ok(!text.includes('\r'), 'LF-only')
    const statements = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    assert.deepEqual(statements, ['ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;'])
    reset()
    assert.deepEqual(db.prepare('SELECT must_change_password AS f FROM users ORDER BY id').all({}).map((r) => r.f), [0, 0, 0, 0])
  })

  await check('signing in with Admin123456! marks the account; only the self change-password gets through until it is changed', async () => {
    reset()
    const signIn = await login('owner', LEAKED)
    assert.equal(signIn.body.user.must_change_password, 1, 'the login payload says so')
    assert.equal(flagOf(2), 1, 'the account is marked')
    const token = signIn.minted
    const me = await send(authRoute, 'GET', '/me', token)
    assert.equal(me.status, 200, 'the app can still read who is signed in')
    assert.equal(me.body.user.must_change_password, 1, '/me carries the flag')
    const blocked = await someProtectedCall(token)
    assert.equal(blocked.status, 403, blocked.text)
    assert.equal(blocked.body.code, 'password_change_required')
    const profile = await send(usersRoute, 'PUT', '/users/2/profile', token, { username: 'owner', name: 'Owner', currentPassword: LEAKED })
    assert.equal(profile.status, 403, 'profile save is blocked too')
    const other = await changePassword(token, 3, LEAKED, 'whatever-9')
    assert.equal(other.status, 403, 'only the OWN change-password is let through')
    assert.equal(other.body.code, 'password_change_required')
    const same = await changePassword(token, 2, LEAKED, LEAKED)
    assert.equal(same.status, 400, same.text)
    assert.equal(same.body.code, 'password_known_leaked')
    const demo = await changePassword(token, 2, LEAKED, 'admin123')
    assert.equal(demo.body.code, 'password_known_leaked', 'admin123 is refused outside local dev')
    assert.equal(passwordOf(2), `hash:${LEAKED}`, 'nothing written yet')
    const fresh = await changePassword(token, 2, LEAKED, 'a-new-owner-pass-7')
    assert.equal(fresh.status, 200, fresh.text)
    assert.equal(flagOf(2), 0, 'the change clears the flag')
    const after = await someProtectedCall(token)
    assert.equal(after.status, 200, `the account works again: ${after.text}`)
  })

  await check('control: an ordinary password signs in unmarked and is not gated', async () => {
    reset()
    const signIn = await login('cashier', 'till-pass-3')
    assert.equal(signIn.body.user.must_change_password, 0)
    assert.equal(flagOf(3), 0)
    assert.equal((await someProtectedCall(signIn.minted)).status, 200)
  })

  await check('admin123 marks the account in production and is tolerated only in local dev; Admin123456! never', async () => {
    reset()
    await login('demo', 'admin123')
    assert.equal(flagOf(4), 1, 'production: admin123 is publicly known')
    const localDev = { BUSINESS_OS_LOCAL_DEV: '1' }
    reset({ vars: localDev })
    await login('demo', 'admin123')
    assert.equal(flagOf(4), 0, 'local dev demo password is not forced')
    await login('owner', LEAKED)
    assert.equal(flagOf(2), 1, 'Admin123456! is forced even in local dev')
    assert.equal(await policy.passwordKnownLeaked('admin123', localDev), false)
    assert.equal(await policy.passwordKnownLeaked(' Admin123456! ', localDev), true, 'trimmed form counts')
    assert.equal(await policy.passwordKnownLeaked('admin1234', {}), false, 'exact match only')
  })

  await check('every staff password writer refuses a known password', async () => {
    reset()
    const admin = (await login('admin', 'admin-strong-1')).minted
    const create = await send(usersRoute, 'POST', '/users', admin, { username: 'newbie', name: 'Newbie', password: LEAKED, role_id: 1 })
    assert.equal(create.status, 400, create.text)
    assert.equal(create.body.code, 'password_known_leaked')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").get({}).n, 0)
    const adminReset = await send(usersRoute, 'POST', '/users/3/reset-password', admin, { newPassword: 'admin123' })
    assert.equal(adminReset.status, 400, adminReset.text)
    assert.equal(adminReset.body.code, 'password_known_leaked')
    assert.equal(passwordOf(3), 'hash:till-pass-3')
    const cashier = (await login('cashier', 'till-pass-3')).minted
    const self = await changePassword(cashier, 3, 'till-pass-3', LEAKED)
    assert.equal(self.body.code, 'password_known_leaked')
    assert.equal(passwordOf(3), 'hash:till-pass-3')
    const link = await send(authRoute, 'POST', '/password-reset/complete', null, { accessToken: 'tok', newPassword: LEAKED })
    assert.equal(link.status, 400, link.text)
    assert.equal(link.body.code, 'password_known_leaked')
    assert.equal(resetLinkConsumed, 0, 'the refusal does not spend the recovery link')
    const otp = await send(authRoute, 'POST', '/password-reset/otp', null, { identifier: 'owner', otp: '123456', newPassword: LEAKED })
    assert.equal(otp.status, 400, otp.text)
    assert.equal(otp.body.code, 'password_known_leaked')
    const adminFixes = await send(usersRoute, 'POST', '/users/3/reset-password', admin, { newPassword: 'a-good-new-pass-5' })
    assert.equal(adminFixes.status, 200, `control: a fresh password is accepted: ${adminFixes.text}`)
  })

  await check('an admin reset or a reset link to a fresh password clears the flag', async () => {
    reset()
    await login('owner', LEAKED)
    assert.equal(flagOf(2), 1)
    const admin = (await login('admin', 'admin-strong-1')).minted
    assert.equal((await send(usersRoute, 'POST', '/users/2/reset-password', admin, { newPassword: 'owner-reset-8' })).status, 200)
    assert.equal(flagOf(2), 0)
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = 2').run({})
    const link = await send(authRoute, 'POST', '/password-reset/complete', null, { accessToken: 'tok', newPassword: 'owner-link-9' })
    assert.equal(link.status, 200, link.text)
    assert.equal(flagOf(2), 0)
  })

  await check('the plaintext never reaches console output or the audit log', async () => {
    reset()
    const lines = []
    const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info }
    for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(' '))
    try {
      const signIn = await login('owner', LEAKED)
      await changePassword(signIn.minted, 2, LEAKED, LEAKED)
      await changePassword(signIn.minted, 2, LEAKED, 'a-new-owner-pass-7')
    } finally { Object.assign(console, saved) }
    assert.equal(lines.join('\n').includes(LEAKED), false, 'console')
    assert.ok(audits.some((a) => a.includes('login_known_leaked_password')), 'the sign-in is audited')
    assert.equal(audits.join('\n').includes(LEAKED), false, 'audit')
  })

  // Owner requirement (27 Sep 2026): the forced change must never be a closed
  // loop -- old -> new works, Sign out works, a reload and a wrong current
  // password keep the change screen, and the new password signs in cleanly.

  await check('owner: Sign out on the change screen finishes -- the sign-out probe answers, logout revokes, the probe then reads 401', async () => {
    assert.equal(SIGNOUT_PROBE_PATH, '/api/sync/owner', 'the path the app probes (frontend/src/api/http.ts)')
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8'), /app\.route\('\/api\/sync', createSyncRoute\(app\)\)/)
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sync.ts'), 'utf8'), /app\.use\('\*', requireAuth\)\s+app\.get\('\/owner'/)
    reset()
    const token = (await login('owner', LEAKED)).minted
    const probe = await send(workerApp, 'GET', SIGNOUT_PROBE_PATH, token)
    assert.equal(probe.status, 200, `the probe must answer for an account that must change: ${probe.text}`)
    assert.equal(probe.body.owner.actor_id, 2)
    for (const [method, url] of [['POST', '/api/sync/outbox'], ['POST', '/api/sync/owner'], ['GET', '/api/sync/owners']]) {
      const closed = await send(workerApp, method, url, token, method === 'POST' ? {} : undefined)
      assert.equal(closed.status, 403, `${method} ${url} stays closed: ${closed.text}`)
      assert.equal(closed.body.code, 'password_change_required')
    }
    const out = await send(authRoute, 'POST', '/logout', token, { expected_actor_id: 2, expected_organization_id: null })
    assert.equal(out.status, 200, out.text)
    const after = await send(workerApp, 'GET', SIGNOUT_PROBE_PATH, token)
    assert.equal(after.status, 401, after.text)
    assert.equal(after.body.code, 'invalid_session', 'the app confirms a sign-out on exactly this')
    assert.equal(flagOf(2), 1, 'signing out does not clear the flag: the next sign-in shows the change screen again')
  })

  await check('owner: a reload on the change screen reads the flag again (GET /bootstrap); after the change it reads 0', async () => {
    reset()
    const token = (await login('owner', LEAKED)).minted
    const boot = await send(authRoute, 'GET', '/bootstrap', token)
    assert.equal(boot.status, 200, boot.text)
    assert.equal(boot.body.user.must_change_password, 1, 'a reload shows the change screen, not the app')
    assert.equal((await changePassword(token, 2, LEAKED, 'a-new-owner-pass-7')).status, 200)
    const again = await send(authRoute, 'GET', '/bootstrap', token)
    assert.equal(again.body.user.must_change_password, 0, 'the next load is the app')
    assert.equal((await someProtectedCall(token)).status, 200)
  })

  await check('owner: a wrong current password stays on the change screen with an error and the usual limit, never a sign-out', async () => {
    reset()
    const token = (await login('owner', LEAKED)).minted
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const wrong = await changePassword(token, 2, 'not-the-password', 'a-new-owner-pass-7')
      assert.equal(wrong.status, 400, `attempt ${attempt}: ${wrong.text}`)
      assert.equal(wrong.body.code, 'incorrect_password')
    }
    const limited = await changePassword(token, 2, 'not-the-password', 'a-new-owner-pass-7')
    assert.equal(limited.status, 429, limited.text)
    assert.equal(limited.body.code, 'current_password_rate_limited')
    assert.equal(flagOf(2), 1, 'still must change')
    assert.equal(passwordOf(2), `hash:${LEAKED}`, 'nothing written')
    const me = await send(authRoute, 'GET', '/me', token)
    assert.equal(me.status, 200, 'still signed in: the screen stays, no bounce to sign-in')
    assert.equal(me.body.user.must_change_password, 1)
  })

  await check('owner: old -> new needs only a password that is not publicly known (no other rule); signing in again with it shows no change screen', async () => {
    reset()
    const token = (await login('owner', LEAKED)).minted
    const changed = await changePassword(token, 2, LEAKED, 'qwerty')
    assert.equal(changed.status, 200, `a plain 6-character password is enough: ${changed.text}`)
    assert.equal(flagOf(2), 0)
    assert.equal((await send(authRoute, 'POST', '/logout', token, { expected_actor_id: 2, expected_organization_id: null })).status, 200)
    const again = await login('owner', 'qwerty')
    assert.equal(again.body.user.must_change_password, 0, 'no forced screen after signing in with the new password')
    assert.equal((await someProtectedCall(again.minted)).status, 200)
    const old = await send(authRoute, 'POST', '/login', null, { username: 'owner', password: LEAKED, deviceId: 'dev-1' })
    assert.equal(old.status, 401, 'the old password is gone')
  })

  await check('before 0202 is applied, sign-in and ordinary calls still work (no 500)', async () => {
    reset({ migrated: false })
    const signIn = await login('owner', LEAKED)
    assert.equal((await someProtectedCall(signIn.minted)).status, 200, 'falls back, cannot force yet')
    const other = await login('cashier', 'till-pass-3')
    assert.equal((await changePassword(other.minted, 3, 'till-pass-3', 'till-pass-4')).status, 200)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
