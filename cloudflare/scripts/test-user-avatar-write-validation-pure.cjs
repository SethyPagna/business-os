// FX-sec item 3 (security hunt H-sec): users.avatar_path had four writers
// and only one validated. PUT /users/:id/avatar requires the path to name an
// IMAGE row in file_assets; the profile save (PUT /users/:id/profile), the
// admin edit (PUT /users/:id) and user create (POST /users) stored whatever
// string arrived -- an external tracking URL, a javascript:/data: URL, or a
// library document -- which every avatar surface then renders as <img src>.
//
// Drives the REAL routes/users.ts over in-memory SQLite and pins one rule on
// all three form writers:
//   - a new, non-empty path must be a library image (same query as the
//     dedicated avatar route) or the save is refused and nothing changes;
//   - the value the account already has is accepted unchanged, so a round
//     trip of an older stored path (the forms always send the current value
//     back) never blocks an unrelated edit;
//   - an empty value clears it; an absent key keeps it.
//
// Run: node scripts/test-user-avatar-write-validation-pure.cjs

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
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'x', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const ADMIN = { id: 1, username: 'owner', isAdmin: true }
const CASHIER = { id: 2, username: 'cashier' }
// Stored before this rule existed and not in the library: must survive a round trip.
const LEGACY = '/uploads/legacy-avatar.jpg'

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO roles(id,name,code) VALUES (1,'Admin','admin'),(2,'Employee','employee')`).run()
  db.prepare(`INSERT INTO organizations(id,name) VALUES (1,'Org')`).run()
  db.prepare(`INSERT INTO users(id,username,name,password,role_id,organization_id,avatar_path) VALUES
    (1,'owner','Owner','hash:owner-pw',1,1,NULL),
    (2,'cashier','Cashier','hash:cashier-pw',2,1,'${LEGACY}')`).run()
  db.prepare(`INSERT INTO file_assets(id,stored_name,public_path,source,media_type) VALUES
    (10,'a10.webp','/uploads/a10.webp','avatar','image'),
    (12,'doc12.pdf','/uploads/doc12.pdf','upload','document')`).run()
  actor = ADMIN
}

const env = () => ({ DB: db, ASSETS: { put: noop, delete: noop } })
async function call(method, url, body) {
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(), ctx)
  return { status: res.status, body: await res.json() }
}
const avatarOf = (id) => db.prepare('SELECT avatar_path FROM users WHERE id = @id').get({ id })?.avatar_path ?? null

const avatarByName = (username) => db.prepare('SELECT avatar_path FROM users WHERE username = @username').get({ username })?.avatar_path ?? null

const BAD = ['https://evil.example/pixel.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '/uploads/nope.png', '/uploads/doc12.pdf']

const writers = {
  profile: (avatar) => { actor = CASHIER; return call('PUT', '/users/2/profile', { username: 'cashier', name: 'Cashier', currentPassword: 'cashier-pw', ...avatar }) },
  adminEdit: (avatar) => { actor = ADMIN; return call('PUT', '/users/2', { username: 'cashier', name: 'Cashier', role_id: 2, ...avatar }) },
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  for (const [label, write] of Object.entries(writers)) {
    await check(`${label}: a path that is not a library image is refused and nothing changes`, async () => {
      for (const bad of BAD) {
        reset()
        const { status, body } = await write({ avatar_path: bad, name: 'Renamed' })
        assert.equal(status, 400, `${bad} -> ${JSON.stringify(body)}`)
        assert.equal(body.code, 'avatar_not_in_library')
        assert.equal(avatarOf(2), LEGACY, bad)
        assert.equal(db.prepare('SELECT name FROM users WHERE id = 2').get().name, 'Cashier', 'the whole save is refused')
      }
    })

    await check(`${label}: a library image is accepted`, async () => {
      const { status, body } = await write({ avatar_path: '/uploads/a10.webp' })
      assert.equal(status, 200, JSON.stringify(body))
      assert.equal(avatarOf(2), '/uploads/a10.webp')
    })

    await check(`${label}: the account's current value round-trips even when it is not in the library`, async () => {
      const { status, body } = await write({ avatar_path: LEGACY })
      assert.equal(status, 200, JSON.stringify(body))
      assert.equal(avatarOf(2), LEGACY)
    })

    await check(`${label}: an empty value clears the photo`, async () => {
      const { status } = await write({ avatar_path: '' })
      assert.equal(status, 200)
      assert.equal(avatarOf(2), null)
    })

    await check(`${label}: an absent key keeps the photo`, async () => {
      const { status } = await write({})
      assert.equal(status, 200)
      assert.equal(avatarOf(2), LEGACY)
    })
  }

  await check('create: a non-library avatar is refused and no user is created', async () => {
    for (const bad of BAD) {
      reset()
      const { status, body } = await call('POST', '/users', { username: 'newbie', name: 'Newbie', password: 'longenough-1', role_id: 2, avatar_path: bad })
      assert.equal(status, 400, `${bad} -> ${JSON.stringify(body)}`)
      assert.equal(body.code, 'avatar_not_in_library')
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'newbie'").get().n, 0)
    }
  })

  await check('create: a library image or no avatar is accepted', async () => {
    let res = await call('POST', '/users', { username: 'newbie', name: 'Newbie', password: 'longenough-1', role_id: 2, avatar_path: '/uploads/a10.webp' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(avatarByName('newbie'), '/uploads/a10.webp')
    res = await call('POST', '/users', { username: 'plain', name: 'Plain', password: 'longenough-1', role_id: 2, avatar_path: '' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(avatarByName('plain'), null)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
