// FX-sec item 2 (security hunt H-sec): the literal username "admin" was an
// administrator credential. lib/permissions.ts's isAdminControlUser() granted
// full control to `username === 'admin'` on its own, and nothing stopped a
// user from renaming themself (PUT /users/:id/profile) or an admin from
// creating/renaming someone else (POST, PUT /users/:id) to "admin" once the
// seeded row had been renamed away. Whoever held that name held every admin
// gate -- user management, restore, factory reset.
//
// Part A drives the REAL lib/permissions.ts: administrator control comes from
// the admin ROLE code or an effective `all` grant, never from the username.
// Every existing administrator still passes (production's one admin row is
// id 1 with role_code 'admin').
// Part B drives the REAL routes/users.ts (with the real permissions module)
// over in-memory SQLite: "admin" (after lower(trim())) is refused as a new or
// changed username on every writer, except the row already holding it may
// keep it.
// Part C: the two sales.ts cashier-filter gates that re-implemented the old
// username rule inline now delegate to isAdminControlUser.
//
// Run: node scripts/test-reserved-admin-username-pure.cjs

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

const permissions = load('lib/permissions.ts')

let failures = 0
async function check(name, fn) {
  try { if (typeof reset === 'function') reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

// ---- Part B fixture -------------------------------------------------------
const SCHEMA = `
  CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, permissions TEXT DEFAULT '{}', code TEXT, is_system INTEGER DEFAULT 0);
  CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, public_id TEXT, is_active INTEGER DEFAULT 1);
  CREATE TABLE organization_groups (id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, slug TEXT, is_active INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    organization_id INTEGER, organization_group_id INTEGER, phone TEXT, phone_lookup TEXT, phone_verified INTEGER DEFAULT 0,
    email TEXT, email_verified INTEGER DEFAULT 0, avatar_path TEXT, role_id INTEGER,
    permissions TEXT DEFAULT '{}', otp_enabled INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    deleted_at TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE file_assets (id INTEGER PRIMARY KEY, stored_name TEXT, public_path TEXT, source TEXT, media_type TEXT);
`

let db
let actor
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

const app = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: (v) => `hash:${v}`, compareSync: (plain, hash) => hash === `hash:${plain}` },
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
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'x', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  // Real module (pure, no imports): a hand-rolled stub lags every member the route starts importing.
  '../lib/passwordPolicy': load('lib/passwordPolicy.ts'),
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

// The seeded admin account was renamed "owner" -- exactly the state in which
// the name "admin" became free for anyone to claim.
const OWNER = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}', role_permissions: '{"all":true}' }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier', role_code: 'employee', permissions: '{}', role_permissions: '{}' }

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO roles(id,name,code,permissions,is_system) VALUES (1,'Admin','admin','{"all":true}',1),(2,'Employee','employee','{}',1)`).run()
  db.prepare(`INSERT INTO organizations(id,name) VALUES (1,'Org')`).run()
  db.prepare(`INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES
    (1,'owner','Owner','hash:owner-pw',1,1),
    (2,'cashier','Cashier','hash:cashier-pw',2,1)`).run()
  actor = OWNER
}

const env = () => ({ DB: db, ASSETS: { put: noop, delete: noop } })
async function call(method, url, body) {
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(), ctx)
  return { status: res.status, body: await res.json() }
}
const usernameOf = (id) => db.prepare('SELECT username FROM users WHERE id = @id').get({ id })?.username
const RESERVED_SPELLINGS = ['admin', 'Admin', ' ADMIN ', 'aDmIn']

;(async () => {
  // ---- Part A --------------------------------------------------------------
  await check('the username alone no longer confers administrator control', async () => {
    for (const username of RESERVED_SPELLINGS) {
      const user = { username, role_code: 'employee', permissions: '{}', role_permissions: '{}' }
      assert.equal(permissions.isAdminControlUser(user), false, JSON.stringify(username))
      assert.equal(permissions.hasPermission(user, 'backup_restore'), false, `${JSON.stringify(username)} must not pass every gate`)
      assert.equal(permissions.getActionTier(user, 'products', 'delete'), 'none')
    }
  })

  await check('every real administrator still passes: admin role code, or an effective all grant', async () => {
    // Production: exactly one row named admin, id 1, role_code 'admin'.
    assert.equal(permissions.isAdminControlUser({ id: 1, username: 'admin', role_code: 'admin', permissions: '{}', role_permissions: '{}' }), true)
    assert.equal(permissions.isAdminControlUser({ username: 'owner', role_code: ' Admin ', permissions: '{}' }), true)
    assert.equal(permissions.isAdminControlUser({ username: 'boss', role_code: 'manager', role_permissions: '{"all":true}' }), true)
    assert.equal(permissions.isAdminControlUser({ username: 'boss', role_code: 'manager', permissions: '{"all":true}' }), true)
    assert.equal(permissions.hasPermission({ username: 'owner', role_code: 'admin' }, 'backup_restore'), true)
    // A user-level all:false still revokes a role grant, as before.
    assert.equal(permissions.isAdminControlUser({ username: 'boss', role_code: 'manager', role_permissions: '{"all":true}', permissions: '{"all":false}' }), false)
    assert.equal(permissions.isAdminControlUser(null), false)
  })

  // ---- Part B --------------------------------------------------------------
  await check('POST /users refuses the reserved name in any spelling', async () => {
    for (const username of RESERVED_SPELLINGS) {
      reset()
      const { status, body } = await call('POST', '/users', { username, name: `N ${username}`, password: 'longenough-1', role_id: 2 })
      assert.equal(status, 400, `${JSON.stringify(username)} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, 'username_reserved')
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2, 'no row created')
    }
  })

  await check('PUT /users/:id (admin edit) refuses renaming someone else to admin', async () => {
    for (const username of RESERVED_SPELLINGS) {
      reset()
      const { status, body } = await call('PUT', '/users/2', { username, name: 'Cashier', role_id: 2, __rename_cascade: 'record_only' })
      assert.equal(status, 400, `${JSON.stringify(username)} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, 'username_reserved')
      assert.equal(usernameOf(2), 'cashier')
    }
  })

  await check('PUT /users/:id/profile refuses a self-rename to admin (with the correct password)', async () => {
    actor = CASHIER
    for (const username of RESERVED_SPELLINGS) {
      reset(); actor = CASHIER
      const { status, body } = await call('PUT', '/users/2/profile', { username, name: 'Cashier', currentPassword: 'cashier-pw', __rename_cascade: 'record_only' })
      assert.equal(status, 400, `${JSON.stringify(username)} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, 'username_reserved')
      assert.equal(usernameOf(2), 'cashier')
    }
  })

  await check('the row already named admin keeps its name on every writer', async () => {
    db.prepare(`INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES (5,' Admin ','Admin','hash:admin-pw',1,1)`).run()
    // Self-service profile save by that account.
    actor = { id: 5, username: ' Admin ', role_code: 'admin', permissions: '{}', role_permissions: '{"all":true}' }
    let res = await call('PUT', '/users/5/profile', { username: 'admin', name: 'Admin', currentPassword: 'admin-pw', __rename_cascade: 'record_only' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(usernameOf(5), 'admin')
    // A peer admin editing that account without touching the name.
    actor = OWNER
    res = await call('PUT', '/users/5', { username: 'admin', name: 'Admin', role_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(usernameOf(5), 'admin')
  })

  await check('ordinary names are unaffected', async () => {
    let res = await call('POST', '/users', { username: 'administrator', name: 'Second', password: 'longenough-1', role_id: 2 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    res = await call('PUT', '/users/2', { username: 'admin2', name: 'Cashier', role_id: 2, __rename_cascade: 'record_only' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(usernameOf(2), 'admin2')
  })

  // ---- Part C --------------------------------------------------------------
  await check("sales.ts's cashier-filter gates use isAdminControlUser, not the username", async () => {
    const salesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
    assert.equal(/username\s*===\s*'admin'/.test(salesSrc), false, "no inline username === 'admin' admin check may remain")
    const gates = salesSrc.split('Administrator access required for cashier user filters.').length - 1
    assert.equal(gates, 2, 'both cashier-filter gates still exist')
    for (const at of [...salesSrc.matchAll(/Administrator access required for cashier user filters\./g)].map((m) => m.index)) {
      assert.match(salesSrc.slice(at - 300, at), /isAdminControlUser\(user\)/)
    }
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
