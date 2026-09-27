// S-auth4c: password reset by administrator approval (migration 0203).
//
// Drives the REAL public POST /api/auth/password-reset/admin-request, the
// REAL administrator list / dismiss routes and the REAL admin reset-password
// in routes/users.ts, over in-memory SQLite with migrations 0202 and 0203
// applied from their files and real sessions.
//
// Pins:
//   - 0203 is LF-only and creates one table and two indexes, nothing else;
//   - a request for exactly one active account records ONE pending row, and
//     a repeat while it is pending adds nothing;
//   - the answer is byte-identical for a real account, an unknown one, an
//     ambiguous one (shared email), an inactive one and a rate-limited one;
//   - limits: 5 per network per hour, 3 per typed identifier per hour;
//   - only administrators can list or dismiss; the admin reset-password
//     resolves the account's pending request; dismiss marks one dismissed;
//     a self-service change resolves nothing;
//   - before 0203 is applied the request answers the same and the list is
//     empty (no 500).

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

const MIGRATION_0202 = path.join(__dirname, '..', 'migrations', '0202_users_must_change_password.sql')
const MIGRATION_0203 = path.join(__dirname, '..', 'migrations', '0203_password_reset_requests.sql')
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')

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
const bcryptStub = { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` }
const guardOverrides = { './rateLimit': rateLimit, './auth': authLib, bcryptjs: bcryptStub, 'hono/cookie': cookie, '../index': {} }
const guard = load('lib/currentPasswordGuard.ts', guardOverrides)
const audits = []
// audit(env, actorId, actorName, action, entity, entityId, details): drop env.
const auditSpy = async (_env, ...args) => { audits.push(JSON.stringify(args)) }
let resetLinkConsumed = 0

const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: bcryptStub,
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': authLib,
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: auditSpy },
  '../lib/permissions': { isAdminControlUser: (u) => Number(u?.id) === 1 },
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

const authRoute = load('routes/auth.ts', {
  hono: require('hono'),
  bcryptjs: bcryptStub,
  '../lib/db': { getDb: (env) => env.DB },
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
let db
let env

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
function reset({ with0203 = true } = {}) {
  db = openDb([SCHEMA])
  const m0202 = readIf(MIGRATION_0202)
  if (m0202) db.exec(m0202)
  if (with0203) {
    const m0203 = readIf(MIGRATION_0203)
    assert.ok(m0203, 'migration 0203 exists')
    db.exec(m0203)
  }
  db.exec(`INSERT INTO users(id,username,name,password,email,is_active) VALUES
    (1,'admin','Admin','hash:admin-strong-1',NULL,1),
    (2,'owner','Owner','hash:owner-pass-2','owner@example.com',1),
    (3,'cashier','Cashier','hash:till-pass-3','shared@example.com',1),
    (4,'cashier2','Cashier Two','hash:till-pass-4','shared@example.com',1),
    (5,'gone','Gone','hash:gone-pass-5','gone@example.com',0)`)
  env = { DB: db }
  audits.length = 0
}

async function ask(identifier, ip = '203.0.113.9') {
  const res = await authRoute.request('/password-reset/admin-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ identifier, deviceName: 'Till 2' }),
  }, env, ctx)
  return { status: res.status, text: await res.text() }
}
const pending = () => db.prepare("SELECT user_id, status, device_name FROM password_reset_requests WHERE status = 'pending' ORDER BY user_id").all({}).map((r) => ({ ...r }))
const statuses = () => db.prepare('SELECT user_id, status, resolved_by FROM password_reset_requests ORDER BY id').all({}).map((r) => ({ ...r }))

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('0203: LF-only; one table, two indexes, nothing else', async () => {
    assert.ok(fs.existsSync(MIGRATION_0203), 'migration 0203 exists')
    const text = fs.readFileSync(MIGRATION_0203, 'utf8')
    assert.ok(!text.includes('\r'), 'LF-only')
    const sql = text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean)
    assert.equal(statements.length, 3)
    assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS password_reset_requests/)
    assert.match(statements[1], /^CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_requests_pending_user/)
    assert.match(statements[2], /^CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status_requested/)
  })

  await check('a request for one active account records one pending row; a repeat adds nothing', async () => {
    reset()
    const first = await ask('owner')
    assert.equal(first.status, 200, first.text)
    const again = await ask('OWNER@example.com', '198.51.100.7')
    assert.equal(again.text, first.text)
    assert.deepEqual(pending(), [{ user_id: 2, status: 'pending', device_name: 'Till 2' }])
    assert.equal(audits.filter((a) => a.includes('password_reset_admin_requested')).length, 1)
  })

  await check('one identical answer: real, unknown, ambiguous (shared email), inactive', async () => {
    reset()
    const real = await ask('owner')
    const answers = [await ask('nobody-here'), await ask('shared@example.com'), await ask('gone')]
    for (const answer of answers) {
      assert.equal(answer.status, real.status)
      assert.equal(answer.text, real.text)
    }
    assert.deepEqual(pending().map((r) => r.user_id), [2], 'only the one real, unambiguous, active account')
  })

  await check('limits: 5 per network and 3 per identifier per hour, refused with the same answer', async () => {
    reset()
    const real = await ask('owner', '192.0.2.1')
    for (const id of ['a1', 'a2', 'a3', 'a4']) await ask(id, '192.0.2.1')
    const overIp = await ask('cashier', '192.0.2.1')
    assert.equal(overIp.text, real.text)
    assert.deepEqual(pending().map((r) => r.user_id), [2], 'the 6th request from one network recorded nothing')
    reset()
    for (const ip of ['192.0.2.5', '192.0.2.6', '192.0.2.7']) await ask('ghost', ip)
    db.exec("UPDATE users SET username = 'ghost' WHERE id = 3")
    const overIdentifier = await ask('ghost', '192.0.2.8')
    assert.equal(overIdentifier.text, real.text)
    assert.deepEqual(pending(), [], 'the 4th request for one identifier recorded nothing')
  })

  await check('only administrators list and dismiss; admin reset resolves; dismiss marks one; self change resolves nothing', async () => {
    reset()
    await ask('owner')
    await ask('cashier', '198.51.100.8')
    const cashier = (await login('cashier', 'till-pass-3')).minted
    assert.equal((await send(usersRoute, 'GET', '/users/password-reset-requests', cashier)).status, 403)
    const admin = (await login('admin', 'admin-strong-1')).minted
    const list = await send(usersRoute, 'GET', '/users/password-reset-requests', admin)
    assert.equal(list.status, 200, list.text)
    assert.deepEqual(list.body.requests.map((r) => r.username).sort(), ['cashier', 'owner'])
    const resetOwner = await send(usersRoute, 'POST', '/users/2/reset-password', admin, { newPassword: 'owner-new-pass-9' })
    assert.equal(resetOwner.status, 200, resetOwner.text)
    const cashierRequest = list.body.requests.find((r) => r.username === 'cashier')
    assert.equal((await send(usersRoute, 'POST', `/users/password-reset-requests/${cashierRequest.id}/dismiss`, cashier)).status, 403)
    const dismissed = await send(usersRoute, 'POST', `/users/password-reset-requests/${cashierRequest.id}/dismiss`, admin)
    assert.equal(dismissed.status, 200, dismissed.text)
    assert.equal((await send(usersRoute, 'POST', `/users/password-reset-requests/${cashierRequest.id}/dismiss`, admin)).status, 404)
    assert.deepEqual(statuses(), [
      { user_id: 2, status: 'resolved', resolved_by: 1 },
      { user_id: 3, status: 'dismissed', resolved_by: 1 },
    ])
    const after = await send(usersRoute, 'GET', '/users/password-reset-requests', admin)
    assert.deepEqual(after.body.requests, [])
    await ask('cashier', '198.51.100.9')
    const own = (await login('cashier', 'till-pass-3')).minted
    const change = await send(usersRoute, 'POST', '/users/3/change-password', own, { currentPassword: 'till-pass-3', newPassword: 'till-pass-33' })
    assert.equal(change.status, 200, change.text)
    assert.deepEqual(pending().map((r) => r.user_id), [3], 'a self-service change is not an administrator answer')
  })

  await check('before 0203 is applied: same answer, empty list, admin reset still works', async () => {
    reset({ with0203: false })
    const answer = await ask('owner')
    assert.equal(answer.status, 200, answer.text)
    const admin = (await login('admin', 'admin-strong-1')).minted
    const list = await send(usersRoute, 'GET', '/users/password-reset-requests', admin)
    assert.equal(list.status, 200, list.text)
    assert.deepEqual(list.body.requests, [])
    assert.equal((await send(usersRoute, 'POST', '/users/2/reset-password', admin, { newPassword: 'owner-new-pass-9' })).status, 200)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
