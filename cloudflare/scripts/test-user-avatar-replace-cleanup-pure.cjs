// Replacing a profile photo (PUT /users/:id/avatar).
//
// c22c19fe made every replace delete the old R2 object + file_assets row when
// its own reference count found nothing; that count missed non-canonical
// references and deleted photos still on show (refuter X1/X2). U-profile3
// (27 Sep 2026), owner rule "nothing may be lost": a replace moves the
// pointer, audits the old path, and NEVER deletes the old photo -- it stays
// in the Library, where an admin deletes it under the Library's in-use check.
//
// Drives the real routes/users.ts PUT /users/:id/avatar over in-memory
// SQLite with a fake R2 bucket and pins:
//   - the replaced photo is kept (object + file_assets row), whoever replaces
//     it and whatever its source;
//   - the pointer change is audited with the old path, so it can be restored;
//   - re-setting the same path is a no-op (no write, no audit);
//   - users.ts has no object-delete path for avatars at all.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const usersSource = path.join(__dirname, '..', 'src', 'routes', 'users.ts')

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
  CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, public_id TEXT);
  CREATE TABLE organization_groups (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT, password TEXT,
    organization_id INTEGER, organization_group_id INTEGER, phone TEXT, phone_verified INTEGER DEFAULT 0,
    email TEXT, email_verified INTEGER DEFAULT 0, avatar_path TEXT, role_id INTEGER,
    permissions TEXT DEFAULT '{}', otp_enabled INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    deleted_at TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE file_assets (id INTEGER PRIMARY KEY, stored_name TEXT, public_path TEXT, source TEXT, media_type TEXT);
  CREATE TABLE products (id INTEGER PRIMARY KEY, image_path TEXT);
  CREATE TABLE product_images (id INTEGER PRIMARY KEY, image_path TEXT);
  CREATE TABLE promotions (id INTEGER PRIMARY KEY, image_path TEXT);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
`

let db
let actor
let r2Deleted
let audits
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

const app = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: (v) => `hash:${v}`, compareSync: () => false },
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  // The last-administrator guard is proven by test-last-admin-guard-pure.cjs; this fixture has no admin rows.
  '../lib/adminControlGuard': { planAdminControlWrite: async () => ({ guard: { sql: 'SELECT 1', params: {} } }), isAdminControlGuardAbort: () => false, lastAdminRequiredBody: () => ({}) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() }, revokeUserSessions: noop },
  '../lib/audit': {
    changedFields: (before, after) => ({ before, after }),
    auditChangeColumns: () => ({}),
    audit: async (...args) => { audits.push(args) },
  },
  '../lib/permissions': { isAdminControlUser: (u) => u?.isAdmin === true },
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.', verifyCurrentPassword: async (_c, _who, plain, hash) => (hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }) },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

function reset() {
  db = openDb([SCHEMA])
  r2Deleted = []
  audits = []
  db.prepare(`INSERT INTO users(id,username,name,avatar_path) VALUES
    (1,'owner','Owner',NULL),
    (2,'cashier','Cashier','/uploads/old10.webp'),
    (3,'manager','Manager',NULL)`).run()
  db.prepare(`INSERT INTO file_assets(id,stored_name,public_path,source,media_type) VALUES
    (10,'old10.webp','/uploads/old10.webp','avatar','image'),
    (11,'lib11.jpg','/uploads/lib11.jpg','upload','image'),
    (20,'new20.webp','/uploads/new20.webp','avatar','image')`).run()
}

const env = () => ({
  DB: db,
  ASSETS: { delete: async (key) => { r2Deleted.push(key) }, put: noop },
})
const avatarOf = (id) => db.prepare('SELECT avatar_path FROM users WHERE id = @id').get({ id }).avatar_path
const assetExists = (id) => !!db.prepare('SELECT id FROM file_assets WHERE id = @id').get({ id })
const fileDeleteAudits = () => audits.filter((a) => a[3] === 'delete' && a[4] === 'file')

async function put(id, avatarPath) {
  const res = await app.request(`/users/${id}/avatar`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_path: avatarPath }),
  }, env(), ctx)
  return { status: res.status, body: await res.json() }
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('replacing a photo keeps the old object and its file_assets row', async () => {
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/new20.webp')
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.changed, true)
    assert.equal(avatarOf(2), '/uploads/new20.webp')
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(10), true, 'the old photo stays in the Library')
    assert.equal(assetExists(20), true)
    assert.equal(fileDeleteAudits().length, 0)
  })

  await check('the replace is audited with the old path, so it can be put back', async () => {
    actor = { id: 2, username: 'cashier' }
    await put(2, '/uploads/new20.webp')
    const pointer = audits.find((a) => a[3] === 'update' && a[4] === 'user')
    assert.ok(pointer)
    assert.deepEqual(pointer[7], { before: { avatar_path: '/uploads/old10.webp' }, after: { avatar_path: '/uploads/new20.webp' } })
    // ...and putting it back works: the kept file is still a library image.
    assert.equal((await put(2, '/uploads/old10.webp')).status, 200)
    assert.equal(avatarOf(2), '/uploads/old10.webp')
  })

  await check('an admin replacing another account photo, or a library-file photo, deletes nothing either', async () => {
    actor = { id: 1, username: 'owner', isAdmin: true }
    assert.equal((await put(2, '/uploads/new20.webp')).status, 200)
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(10), true)
    reset()
    db.prepare("UPDATE users SET avatar_path = '/uploads/lib11.jpg' WHERE id = 2").run()
    actor = { id: 2, username: 'cashier' }
    assert.equal((await put(2, '/uploads/new20.webp')).status, 200)
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(11), true)
  })

  await check('re-setting the same path is a no-op: no write, no audit', async () => {
    db.prepare("UPDATE users SET updated_at = '2026-09-01 00:00:00' WHERE id = 2").run()
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/old10.webp')
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.changed, false)
    assert.deepEqual(r2Deleted, [])
    assert.equal(audits.length, 0)
    assert.equal(db.prepare('SELECT updated_at FROM users WHERE id = 2').get({}).updated_at, '2026-09-01 00:00:00')
  })

  await check('users.ts has no avatar object-delete path left', async () => {
    const source = fs.readFileSync(usersSource, 'utf8')
    assert.doesNotMatch(source, /ASSETS\.delete\(/)
    assert.doesNotMatch(source, /DELETE FROM file_assets/)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
