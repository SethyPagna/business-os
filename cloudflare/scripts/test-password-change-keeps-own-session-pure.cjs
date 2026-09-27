// Changing your own password from My Profile used to sign you out: the
// real revokeUserSessions revoked every session of the user, including the
// one that made the change, so the next request bounced to the login page.
//
// Drives the real routes/users.ts password handlers against the real
// lib/auth.ts revokeUserSessions over in-memory SQLite, with real cookies:
//   - self change-password  -> this cookie's session survives, every other
//                              session of the same user is revoked;
//   - admin reset of another user -> ALL of that user's sessions are revoked,
//                              the admin's own sessions are untouched;
//   - revokeUserSessions with no keep (deactivation, sign-out-everywhere,
//     OTP recovery) still revokes everything;
//   - a keep context whose cookie belongs to a different user spares nothing.

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
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    permissions TEXT DEFAULT '{}', role_id INTEGER, is_active INTEGER DEFAULT 1,
    deleted_at TEXT, updated_at TEXT
  );
  CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL, revoked_at TEXT
  );
`

const sha = (token) => crypto.createHash('sha256').update(token).digest('hex')

let db
let actor
const authLib = load('lib/auth.ts', { './db': { getDb: (env) => env.DB } })
const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': {
    requireAuth: async (c, next) => { c.set('user', actor); return next() },
    revokeUserSessions: authLib.revokeUserSessions,
  },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({}), audit: async () => {} },
  '../lib/permissions': { isAdminControlUser: (u) => u?.isAdmin === true },
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), peekRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), recordRateLimitEvent: async () => {}, getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO users(id,username,name,password,is_active) VALUES
    (1,'owner','Owner','hash:old-owner',1),
    (2,'cashier','Cashier','hash:old-cashier',1)`).run()
  const sessions = [
    [11, 1, 'owner-laptop'], [12, 1, 'owner-phone'],
    [21, 2, 'cashier-till'], [22, 2, 'cashier-phone'],
  ]
  for (const [id, userId, token] of sessions) {
    db.prepare('INSERT INTO user_sessions(id,user_id,token_hash) VALUES(@id,@user_id,@token_hash)').run({ id, user_id: userId, token_hash: sha(token) })
  }
}

function live() {
  return db.prepare('SELECT id FROM user_sessions WHERE revoked_at IS NULL ORDER BY id').all({}).map((r) => r.id)
}

async function post(url, body, cookieToken) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookieToken) headers.Cookie = `bos_session=${cookieToken}`
  return usersRoute.request(url, { method: 'POST', headers, body: JSON.stringify(body) }, { DB: db }, ctx)
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('self change-password keeps the current session and revokes the other devices', async () => {
    actor = { id: 2, username: 'cashier', name: 'Cashier' }
    const res = await post('/users/2/change-password', { currentPassword: 'old-cashier', newPassword: 'new-cashier-pass' }, 'cashier-till')
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(live(), [11, 12, 21], 'cashier-till (21) survives, cashier-phone (22) is revoked, owner untouched')
    assert.equal(db.prepare('SELECT password FROM users WHERE id = 2').get({}).password, 'hash:new-cashier-pass')
  })

  await check('admin reset of another user revokes ALL of that user\'s sessions, never the admin\'s', async () => {
    actor = { id: 1, username: 'owner', name: 'Owner', isAdmin: true }
    const res = await post('/users/2/reset-password', { newPassword: 'reset-by-admin' }, 'owner-laptop')
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(live(), [11, 12], 'both cashier sessions revoked; owner sessions intact')
  })

  await check('admin resetting their OWN password through reset-password keeps their current session', async () => {
    actor = { id: 1, username: 'owner', name: 'Owner', isAdmin: true }
    const res = await post('/users/1/reset-password', { newPassword: 'owner-new' }, 'owner-phone')
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(live(), [12, 21, 22])
  })

  await check('a wrong current password changes nothing and revokes nothing', async () => {
    actor = { id: 2, username: 'cashier', name: 'Cashier' }
    const res = await post('/users/2/change-password', { currentPassword: 'nope', newPassword: 'new-cashier-pass' }, 'cashier-till')
    // 400, not 401: the client treats a 401 on /api as a possibly dead
    // session and runs its sign-out recovery over a typo.
    assert.equal(res.status, 400)
    assert.equal((await res.json()).code, 'incorrect_password')
    assert.deepEqual(live(), [11, 12, 21, 22])
    assert.equal(db.prepare('SELECT password FROM users WHERE id = 2').get({}).password, 'hash:old-cashier')
  })

  await check('revokeUserSessions without a keep still revokes every session (deactivation / sign-out-everywhere / OTP recovery)', async () => {
    await authLib.revokeUserSessions({ DB: db }, 1)
    assert.deepEqual(live(), [21, 22])
  })

  await check('a keep context whose cookie belongs to another user spares none of the target\'s sessions', async () => {
    const fakeContext = { req: { raw: new Request('https://x/', { headers: { Cookie: 'bos_session=owner-laptop' } }), header: (name) => (name.toLowerCase() === 'cookie' ? 'bos_session=owner-laptop' : undefined) } }
    await authLib.revokeUserSessions({ DB: db }, 2, { keepCurrentSessionOf: fakeContext })
    assert.deepEqual(live(), [11, 12])
    // Control: the same context DOES keep its own session when aimed at its
    // owner, so the assertion above is not passing on an unread cookie.
    await authLib.revokeUserSessions({ DB: db }, 1, { keepCurrentSessionOf: fakeContext })
    assert.deepEqual(live(), [11])
  })

  await check('no cookie on the request falls back to revoking everything', async () => {
    actor = { id: 2, username: 'cashier', name: 'Cashier' }
    const res = await post('/users/2/change-password', { currentPassword: 'old-cashier', newPassword: 'new-cashier-pass' }, null)
    assert.equal(res.status, 200, await res.text())
    assert.deepEqual(live(), [11, 12])
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
