// AUTH-P1 (P1-B): one rule for every NEW password, enforced by the Worker and
// mirrored by the app (frontend/src/utils/passwordRules.ts, parity pinned by
// frontend/tests/passwordRules.test.ts):
//   - at least MIN_PASSWORD_LENGTH characters (6 until the owner rules on Q4);
//   - no leading or trailing whitespace: refused, never trimmed, so the value
//     a password manager saves is the value that was hashed;
//   - at most 72 UTF-8 bytes (bcrypt ignores everything after byte 72).
// Existing passwords are untouched: sign-in still compares the raw value.
//
// Part A drives the REAL lib/passwordPolicy.ts. Part B drives the REAL
// routes/users.ts (create, self change, admin reset) over in-memory SQLite
// with a bcrypt stub that records exactly what was hashed.
//
// Run: node scripts/test-new-password-policy-pure.cjs

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

const readSource = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
const policy = load('lib/passwordPolicy.ts')
const permissions = load('lib/permissions.ts')

const KHMER_KA = 'ក'
const NEW_PASSWORD_CODES = ['password_too_short', 'password_edge_whitespace', 'password_too_long']

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

const SCHEMA = `
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT, is_system INTEGER DEFAULT 0);
  CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, public_id TEXT, is_active INTEGER DEFAULT 1);
  CREATE TABLE organization_groups (id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, slug TEXT, is_active INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    organization_id INTEGER, organization_group_id INTEGER, phone TEXT, phone_lookup TEXT, phone_verified INTEGER DEFAULT 0,
    email TEXT, email_verified INTEGER DEFAULT 0, avatar_path TEXT, role_id INTEGER,
    permissions TEXT DEFAULT '{}', otp_enabled INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
    deleted_at TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE password_reset_requests (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, resolved_by INTEGER, resolved_at TEXT);
`

let db
let actor
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
const hashed = (value) => `hash:${value}`

const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: (v) => hashed(v), compareSync: (plain, hash) => hash === hashed(plain) },
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/adminControlGuard': load('lib/adminControlGuard.ts', { './permissions': permissions }),
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() }, revokeUserSessions: noop },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: noop },
  '../lib/permissions': permissions,
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'x', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === hashed(plain) ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': policy,
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const OWNER = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}', role_permissions: '{"all":true}' }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier', role_code: 'employee', permissions: '{}', role_permissions: '{}' }

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO roles(id,name,code,permissions,is_system) VALUES (1,'Admin','admin','{"all":true}',1),(2,'Employee','employee','{}',1)`).run()
  db.prepare(`INSERT INTO organizations(id,name) VALUES (1,'Org')`).run()
  db.prepare(`INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES
    (1,'owner','Owner','${hashed('owner-pw-1')}',1,1),
    (2,'cashier','Cashier','${hashed('cashier-pw-2')}',2,1)`).run()
  actor = OWNER
}

const env = () => ({ DB: db, ASSETS: { put: noop, delete: noop } })
async function call(method, url, body) {
  const res = await usersRoute.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(), ctx)
  return { status: res.status, body: await res.json() }
}
const storedHash = (id) => db.prepare('SELECT password FROM users WHERE id = @id').get({ id })?.password
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n

const REFUSED = [
  { password: 'abcde', code: 'password_too_short' },
  { password: ' abcdef', code: 'password_edge_whitespace' },
  { password: 'abcdef ', code: 'password_edge_whitespace' },
  { password: '\tabcdefg', code: 'password_edge_whitespace' },
  { password: KHMER_KA.repeat(25), code: 'password_too_long' },
  { password: 'a'.repeat(73), code: 'password_too_long' },
]

;(async () => {
  // ---- Part A: the rule --------------------------------------------------
  await check('the minimum stays 6 (owner Q4 open) and the byte ceiling is 72', async () => {
    assert.equal(policy.MIN_PASSWORD_LENGTH, 6)
    assert.equal(policy.MAX_PASSWORD_BYTES, 72)
  })

  await check('too short: 5 characters refused, 6 accepted', async () => {
    assert.equal(policy.newPasswordProblem(''), 'password_too_short')
    assert.equal(policy.newPasswordProblem(undefined), 'password_too_short')
    assert.equal(policy.newPasswordProblem('abcde'), 'password_too_short')
    assert.equal(policy.newPasswordProblem('abcdef'), null)
  })

  await check('edge whitespace is refused, inner spaces are fine', async () => {
    for (const value of [' abcdef', 'abcdef ', '\tabcdef', 'abcdef\n', ' abcdef']) {
      assert.equal(policy.newPasswordProblem(value), 'password_edge_whitespace', JSON.stringify(value))
    }
    assert.equal(policy.newPasswordProblem('abc def'), null)
    assert.equal(policy.newPasswordProblem('correct horse battery'), null)
  })

  await check('the ceiling counts UTF-8 bytes, not characters', async () => {
    assert.equal(policy.newPasswordProblem('a'.repeat(72)), null)
    assert.equal(policy.newPasswordProblem('a'.repeat(73)), 'password_too_long')
    assert.equal(policy.newPasswordProblem(KHMER_KA.repeat(24)), null, '24 Khmer characters = 72 bytes')
    assert.equal(policy.newPasswordProblem(KHMER_KA.repeat(25)), 'password_too_long', '25 Khmer characters = 75 bytes, only 25 UTF-16 units')
    assert.equal(policy.newPasswordProblem('\u{1F511}'.repeat(19)), 'password_too_long', '19 four-byte characters = 76 bytes')
  })

  await check('every refusal has English server text for API callers', async () => {
    for (const code of NEW_PASSWORD_CODES) {
      const text = policy.newPasswordProblemError(code)
      assert.equal(typeof text, 'string')
      assert.ok(text.trim().length > 10, code)
    }
    assert.match(policy.newPasswordProblemError('password_too_short'), /6/)
  })

  // ---- Part B: routes/users.ts ---------------------------------------------
  await check('POST /users refuses each problem with its code and creates nothing', async () => {
    for (const { password, code } of REFUSED) {
      reset()
      const { status, body } = await call('POST', '/users', { username: 'newbie', name: 'Newbie', password, role_id: 2 })
      assert.equal(status, 400, `${JSON.stringify(password)} -> ${JSON.stringify(body)}`)
      assert.equal(body.success, false)
      assert.equal(body.code, code, JSON.stringify(password))
      assert.equal(typeof body.error, 'string')
      assert.equal(userCount(), 2, 'no row created')
    }
  })

  await check('POST /users stores exactly what was typed (no silent trim)', async () => {
    reset()
    const { status, body } = await call('POST', '/users', { username: 'newbie', name: 'Newbie', password: 'two words 1', role_id: 2 })
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(db.prepare("SELECT password FROM users WHERE username = 'newbie'").get().password, hashed('two words 1'))
  })

  await check('self change-password refuses each problem before any write', async () => {
    for (const { password, code } of REFUSED) {
      reset(); actor = CASHIER
      const { status, body } = await call('POST', '/users/2/change-password', { currentPassword: 'cashier-pw-2', newPassword: password })
      assert.equal(status, 400, `${JSON.stringify(password)} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, code, JSON.stringify(password))
      assert.equal(storedHash(2), hashed('cashier-pw-2'), 'password unchanged')
    }
  })

  await check('admin reset-password refuses each problem before any write', async () => {
    for (const { password, code } of REFUSED) {
      reset()
      const { status, body } = await call('POST', '/users/2/reset-password', { newPassword: password })
      assert.equal(status, 400, `${JSON.stringify(password)} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, code, JSON.stringify(password))
      assert.equal(storedHash(2), hashed('cashier-pw-2'), 'password unchanged')
    }
  })

  await check('a valid change and a valid reset store the value exactly as typed', async () => {
    reset(); actor = CASHIER
    let res = await call('POST', '/users/2/change-password', { currentPassword: 'cashier-pw-2', newPassword: 'new cashier 3' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(storedHash(2), hashed('new cashier 3'))
    actor = OWNER
    res = await call('POST', '/users/2/reset-password', { newPassword: KHMER_KA.repeat(24) })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(storedHash(2), hashed(KHMER_KA.repeat(24)))
  })

  await check('users.ts reads the new-password body fields untrimmed and checks them with newPasswordProblem', async () => {
    const source = readSource('routes/users.ts')
    assert.doesNotMatch(source, /String\(body\.password \|\| ''\)\.trim\(\)/)
    assert.doesNotMatch(source, /String\(body\.newPassword \|\| body\.new_password \|\| ''\)\.trim\(\)/)
    assert.equal((source.match(/newPasswordProblem\(/g) || []).length, 2, 'create and the shared change/reset handler')
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
