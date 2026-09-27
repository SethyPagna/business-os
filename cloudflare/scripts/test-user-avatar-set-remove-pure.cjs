// My Profile said "Avatar uploaded" after POST /users/avatar-upload stored the
// image, but nothing wrote users.avatar_path except a full "Save profile"
// (current password required for non-admins), so the photo vanished on the
// next load. There was also no way to remove a photo.
//
// Drives the real routes/users.ts PUT/DELETE /users/:id/avatar over
// in-memory SQLite with a fake R2 bucket and pins:
//   - set: persists a library IMAGE path; refuses unknown / non-image paths
//     and other people's accounts (unless admin);
//   - remove: clears the pointer, audits the old path, and NEVER deletes the
//     stored object or its file_assets row (U-profile3: nothing may be lost;
//     the old photo stays in the Library under the Library's in-use check).

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
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '', passwordKnownLeaked: () => false, setPasswordMustChange: async () => {} },
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
    (2,'cashier','Cashier',NULL),
    (3,'manager','Manager',NULL)`).run()
  db.prepare(`INSERT INTO file_assets(id,stored_name,public_path,source,media_type) VALUES
    (10,'a10.webp','/uploads/a10.webp','avatar','image'),
    (11,'lib11.jpg','/uploads/lib11.jpg','upload','image'),
    (12,'doc12.pdf','/uploads/doc12.pdf','upload','document')`).run()
}

const env = () => ({
  DB: db,
  ASSETS: { delete: async (key) => { r2Deleted.push(key) }, put: noop },
})
const avatarOf = (id) => db.prepare('SELECT avatar_path FROM users WHERE id = @id').get({ id }).avatar_path
const assetExists = (id) => !!db.prepare('SELECT id FROM file_assets WHERE id = @id').get({ id })

async function put(id, avatarPath) {
  const res = await app.request(`/users/${id}/avatar`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_path: avatarPath }),
  }, env(), ctx)
  return { status: res.status, body: await res.json() }
}
async function del(id) {
  const res = await app.request(`/users/${id}/avatar`, { method: 'DELETE' }, env(), ctx)
  return { status: res.status, body: await res.json() }
}

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('setting your own photo persists it on the account (no password, no full-form save)', async () => {
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/a10.webp')
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(avatarOf(2), '/uploads/a10.webp')
    assert.equal(body.avatar_path, '/uploads/a10.webp', 'returns the fresh user row (with updated_at) for the client')
    const avatarAudit = audits.find((a) => a[3] === 'update' && a[4] === 'user')
    assert.ok(avatarAudit, 'the change is audited')
    assert.deepEqual(avatarAudit[7], { before: { avatar_path: null }, after: { avatar_path: '/uploads/a10.webp' } })
  })

  await check('a picked library image is accepted too', async () => {
    actor = { id: 2, username: 'cashier' }
    assert.equal((await put(2, '/uploads/lib11.jpg')).status, 200)
    assert.equal(avatarOf(2), '/uploads/lib11.jpg')
  })

  await check('a path that is not a library image is refused and nothing changes', async () => {
    actor = { id: 2, username: 'cashier' }
    assert.equal((await put(2, '/uploads/nope.png')).status, 400)
    assert.equal((await put(2, '/uploads/doc12.pdf')).status, 400)
    assert.equal((await put(2, 'https://evil.example/x.png')).status, 400)
    assert.equal(avatarOf(2), null)
  })

  await check('a non-admin cannot set or remove someone else\'s photo; an admin can', async () => {
    actor = { id: 2, username: 'cashier' }
    assert.equal((await put(3, '/uploads/a10.webp')).status, 403)
    assert.equal((await del(3)).status, 403)
    actor = { id: 1, username: 'owner', isAdmin: true }
    assert.equal((await put(3, '/uploads/a10.webp')).status, 200)
    assert.equal(avatarOf(3), '/uploads/a10.webp')
  })

  await check('removing a photo clears the pointer, audits the old path, and keeps the object', async () => {
    for (const [path, id] of [['/uploads/a10.webp', 10], ['/uploads/lib11.jpg', 11]]) {
      reset()
      db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: path })
      actor = { id: 2, username: 'cashier' }
      const { status, body } = await del(2)
      assert.equal(status, 200, JSON.stringify(body))
      assert.equal(body.removed, true)
      assert.equal(avatarOf(2), null)
      assert.deepEqual(r2Deleted, [], path)
      assert.equal(assetExists(id), true, path)
      assert.equal(audits.filter((a) => a[4] === 'file').length, 0, 'no file is deleted, so no file-delete audit')
      const pointer = audits.find((a) => a[3] === 'update' && a[4] === 'user')
      assert.ok(pointer, 'the pointer change is audited')
      assert.deepEqual(pointer[7], { before: { avatar_path: path }, after: { avatar_path: null } }, 'the old path is kept for recovery')
    }
  })

  await check('an admin removing another account\'s photo keeps the object too', async () => {
    db.prepare("UPDATE users SET avatar_path = '/uploads/a10.webp' WHERE id = 3").run()
    actor = { id: 1, username: 'owner', isAdmin: true }
    const { status } = await del(3)
    assert.equal(status, 200)
    assert.equal(avatarOf(3), null)
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(10), true)
  })

  await check('removing when there is no photo is a harmless no-op', async () => {
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await del(2)
    assert.equal(status, 200)
    assert.equal(body.removed, false)
    assert.deepEqual(r2Deleted, [])
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
