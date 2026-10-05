// S-auth4: the current-password allowance cannot be multiplied by minting
// sessions through POST /api/auth/session-duration.
//
// /session-duration creates a NEW session from an existing one with no
// password and leaves the old cookie valid. The guard used to key per cookie,
// so one stolen session could mint N more and get 10 guesses from each.
//
// Drives the REAL lib/auth.ts (createSession, requireAuth's session lookup,
// currentSessionLimitFamily), the real lib/currentPasswordGuard.ts and
// lib/rateLimit.ts, the real /session-duration route and the real
// change-password route over in-memory SQLite, with real Set-Cookie tokens.
// The user_sessions table gets migration 0201 applied from its file.
//
// Pins:
//   - migration 0201 is LF-only, schema-only, and leaves existing rows alone:
//     their family is their own id (NULL column), no backfill needed;
//   - one sign-in plus 5 minted sessions (and a session minted from a minted
//     one) get at most 10 password compares in total, not 10 each;
//   - the right password from ANY session of that family is refused once the
//     family is spent;
//   - control (X5 kept): a fresh sign-in of the same account keeps its full
//     allowance, and still works after the stolen family is spent;
//   - an admin on another user keeps the actor+target key: the admin is
//     limited, the target is not;
//   - /session-duration itself is capped at 10 per 15 minutes per family,
//     and a fresh sign-in is not affected by another family's cap.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { passwordHashStub, failedSignInCostStub } = require('./harness/password_hash_stub.cjs')
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

const MIGRATION_0201 = path.join(__dirname, '..', 'migrations', '0201_user_sessions_limit_family.sql')
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
  -- migrations/0001_init.sql + 0006_session_device_link.sql
  CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    device_name TEXT,
    device_tz TEXT,
    client_time TEXT,
    user_agent TEXT,
    last_ip TEXT,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    device_id TEXT
  );
  CREATE UNIQUE INDEX idx_user_sessions_token_hash_unique_pg ON user_sessions (token_hash);
`
// Before the fix there is no 0201 file; the column is harmless to the old
// code, so the test still runs there and fails on BEHAVIOUR, not on ENOENT.
const MIGRATION_SQL = fs.existsSync(MIGRATION_0201)
  ? fs.readFileSync(MIGRATION_0201, 'utf8')
  : 'ALTER TABLE user_sessions ADD COLUMN limit_family_id INTEGER;'

const noop = async () => {}
// lib/db.ts answers run() with { changes }; the harness answers D1's raw
// { meta: { changes } }. Every call is async, as on D1.
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
const guard = load('lib/currentPasswordGuard.ts', { './rateLimit': rateLimit, './auth': authLib, './passwordHash': passwordHashStub, 'hono/cookie': cookie, '../index': {} })

const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/failedSignInCost': failedSignInCostStub,
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': { ...authLib, revokeUserSessions: noop },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: noop },
  ...withAdminControlGuard({ isAdminControlUser: (u) => Number(u?.id) === 1 }),
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': rateLimit,
  '../lib/currentPasswordGuard': guard,
  '../lib/passwordPolicy': { newPasswordProblem: () => null, newPasswordProblemError: () => '', passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  '../lib/passwordHash': passwordHashStub,
  '../lib/failedSignInCost': failedSignInCostStub,
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': authLib,
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
  '../lib/passwordPolicy': { newPasswordProblem: () => null, newPasswordProblemError: () => '', passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/settingsSensitive': { stripSensitiveSettings: (v) => v },
  '../lib/otpChallenge': { issueOtpChallenge: async () => 'ch', isLiveOtpChallenge: async () => false, consumeOtpChallenge: noop },
  '../lib/loginLockout': { recordFailedLogin: noop, getLoginLockoutState: async () => ({ locked: false }), clearLoginLockout: noop },
  '../lib/deviceTrust': { requiresDeviceApproval: () => false, checkDeviceTrust: async () => ({ status: 'approved' }) },
  '../lib/otpReplay': { isOtpStepReplayed: async () => false, markOtpStepUsed: noop },
  '../lib/googleOauth': {},
  '../index': {},
}).default

const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
let db
let env

function reset() {
  db = openDb([SCHEMA])
  db.exec(MIGRATION_SQL)
  db.prepare(`INSERT INTO users(id,username,name,password) VALUES
    (1,'owner','Owner','hash:owner-pass'),
    (2,'cashier','Cashier','hash:p0')`).run({})
  env = { DB: db }
}

// A real sign-in: the session row the login/OTP/Google routes create.
async function signIn(userId) {
  const session = await authLib.createSession(env, userId, { sessionDuration: 'always' })
  return session.token
}

async function send(route, method, url, token, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Cookie = `bos_session=${token}`
  const res = await route.request(url, { method, headers, body: JSON.stringify(body || {}) }, env, ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  const setCookie = res.headers.get('set-cookie') || ''
  const minted = /bos_session=([^;]+)/.exec(setCookie)?.[1] || null
  return { status: res.status, body: json, text, minted }
}

async function mint(token) {
  const res = await send(authRoute, 'POST', '/session-duration', token, { sessionDuration: '7d' })
  assert.equal(res.status, 200, `session-duration: ${res.text}`)
  assert.ok(res.minted && res.minted !== token, 'a new session cookie was issued')
  return res.minted
}

const changePassword = (token, id, currentPassword, newPassword) =>
  send(usersRoute, 'POST', `/users/${id}/change-password`, token, { currentPassword, newPassword })
const saveProfile = (token, id, currentPassword) =>
  send(usersRoute, 'PUT', `/users/${id}/profile`, token, { username: 'cashier', name: 'Cashier', currentPassword })
const passwordOf = (id) => db.prepare('SELECT password FROM users WHERE id = @id').get({ id }).password

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('0201: LF-only, one additive column, existing rows untouched and their own family', async () => {
    assert.ok(fs.existsSync(MIGRATION_0201), 'migration 0201 exists')
    const text = fs.readFileSync(MIGRATION_0201, 'utf8')
    assert.ok(!text.includes('\r'), 'LF-only')
    const statements = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    assert.deepEqual(statements, ['ALTER TABLE user_sessions ADD COLUMN limit_family_id INTEGER;'])
    const pre = openDb([SCHEMA])
    pre.prepare("INSERT INTO user_sessions(user_id, token_hash, expires_at) VALUES (2,'h1','2099-01-01'),(2,'h2','2099-01-01')").run({})
    const before = JSON.stringify(pre.prepare('SELECT * FROM user_sessions ORDER BY id').all({}))
    pre.exec(text)
    const rows = pre.prepare('SELECT * FROM user_sessions ORDER BY id').all({})
    assert.equal(JSON.stringify(rows.map(({ limit_family_id, ...rest }) => rest)), before, 'existing columns byte-identical')
    assert.ok(rows.every((r) => r.limit_family_id === null), 'no backfill')
    const families = pre.prepare('SELECT COALESCE(limit_family_id, id) AS f FROM user_sessions ORDER BY id').all({}).map((r) => r.f)
    assert.deepEqual(families, rows.map((r) => r.id), 'each existing row is its own sign-in')
  })

  await check('minting 5 sessions through /session-duration does not multiply the allowance: at most 10 compares in total', async () => {
    const stolen = await signIn(2)
    const family = [stolen]
    for (let i = 0; i < 5; i += 1) family.push(await mint(stolen))
    // A session minted from a minted session is still the same sign-in.
    family.push(await mint(family[family.length - 1]))
    assert.equal(new Set(family).size, 7, 'seven distinct live cookies')
    let compared = 0
    let refused = 0
    for (const token of family) {
      for (let i = 0; i < 10; i += 1) {
        const res = await changePassword(token, 2, 'wrong', 'x')
        if (res.status === 400) compared += 1
        else if (res.status === 429) refused += 1
        else assert.fail(`unexpected ${res.status}: ${res.text}`)
      }
    }
    console.log(`  7 sessions x 10 wrong guesses: ${compared} compared, ${refused} refused`)
    assert.ok(compared <= 10, `one sign-in got ${compared} password compares across its minted sessions; the allowance is 10`)
    assert.equal(compared + refused, 70)
    for (const token of family) {
      const right = await changePassword(token, 2, 'p0', 'p1')
      assert.equal(right.status, 429, `every session of the spent family is refused: ${right.text}`)
    }
    assert.equal(passwordOf(2), 'hash:p0', 'nothing changed')
  })

  await check('control (X5 kept): a fresh sign-in keeps its full allowance after the stolen family is spent', async () => {
    const stolen = await signIn(2)
    const child = await mint(stolen)
    for (let i = 0; i < 10; i += 1) assert.equal((await changePassword(i % 2 ? child : stolen, 2, 'wrong', 'x')).status, 400)
    assert.equal((await changePassword(child, 2, 'p0', 'p1')).status, 429)
    const own = await signIn(2)
    for (let i = 0; i < 9; i += 1) assert.equal((await changePassword(own, 2, 'wrong', 'x')).status, 400, `own miss ${i + 1}`)
    const res = await changePassword(own, 2, 'p0', 'p1')
    assert.equal(res.status, 200, res.text)
    assert.equal(passwordOf(2), 'hash:p1')
  })

  await check('an admin on another user keeps the actor+target key: admin limited, target untouched', async () => {
    const admin = await signIn(1)
    const adminChild = await mint(admin)
    for (let i = 0; i < 10; i += 1) {
      const res = await saveProfile(i % 2 ? adminChild : admin, 2, 'wrong')
      assert.equal(res.status, 400, res.text)
    }
    assert.equal((await saveProfile(adminChild, 2, 'p0')).status, 429, 'the admin is limited against this target')
    const own = await signIn(2)
    const res = await changePassword(own, 2, 'p0', 'p1')
    assert.equal(res.status, 200, res.text)
    const keys = db.prepare('SELECT DISTINCT client_key FROM rate_limit_events WHERE bucket = @b').all({ b: 'auth:current_password' }).map((r) => r.client_key)
    assert.deepEqual(keys, ['actor:1:target:2'])
  })

  await check('/session-duration is capped at 10 per 15 minutes per sign-in; another sign-in is unaffected', async () => {
    const stolen = await signIn(2)
    let token = stolen
    for (let i = 0; i < 10; i += 1) token = await mint(i % 2 ? stolen : token)
    const over = await send(authRoute, 'POST', '/session-duration', token, { sessionDuration: '7d' })
    assert.equal(over.status, 429, over.text)
    assert.equal(over.body.code, 'session_duration_rate_limited')
    assert.equal(over.minted, null, 'no cookie issued when refused')
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get({}).n
    assert.equal(sessions, 11, 'the refused call minted no session row')
    const own = await signIn(2)
    await mint(own)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
