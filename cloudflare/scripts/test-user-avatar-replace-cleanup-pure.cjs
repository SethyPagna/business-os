// Replacing a profile photo left the old file in storage: PUT
// /users/:id/avatar moved the pointer and never looked back, while DELETE
// cleaned up. Every re-crop of a photo leaked one R2 object + file_assets row.
//
// Drives the real routes/users.ts PUT /users/:id/avatar over in-memory
// SQLite with a fake R2 bucket and pins:
//   - the replaced avatar upload is deleted (object + file_assets row) when
//     nothing else references it -- DELETE's exact rule;
//   - it is kept when another user, a product, a gallery row, a promotion or
//     a setting still references it, or when it is a general library file;
//   - re-setting the same path is a no-op (no write, no audit, no delete);
//   - there is still ONE reference check in users.ts, shared by both routes.

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
  await check('replacing an unshared avatar upload deletes the old object and its file_assets row', async () => {
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/new20.webp')
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(avatarOf(2), '/uploads/new20.webp')
    assert.deepEqual(r2Deleted, ['uploads/old10.webp'])
    assert.equal(assetExists(10), false, 'old file_assets row gone')
    assert.equal(assetExists(20), true, 'the new photo is untouched')
    assert.equal(body.previousObjectDeleted, true)
    const deleted = fileDeleteAudits()
    assert.equal(deleted.length, 1, 'the object deletion is audited')
    assert.equal(deleted[0][5], 10)
    assert.equal(deleted[0][6].reason, 'avatar_replaced')
  })

  await check('an admin replacing someone else\'s photo cleans up the same way', async () => {
    actor = { id: 1, username: 'owner', isAdmin: true }
    assert.equal((await put(2, '/uploads/new20.webp')).status, 200)
    assert.deepEqual(r2Deleted, ['uploads/old10.webp'])
  })

  await check('the old avatar is kept while another user still shows it', async () => {
    db.prepare("UPDATE users SET avatar_path = '/uploads/old10.webp' WHERE id = 3").run()
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/new20.webp')
    assert.equal(status, 200)
    assert.equal(avatarOf(2), '/uploads/new20.webp')
    assert.equal(avatarOf(3), '/uploads/old10.webp')
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(10), true)
    assert.equal(body.previousObjectDeleted, false)
  })

  await check('the old avatar is kept while a product, gallery row, promotion or setting references it', async () => {
    actor = { id: 2, username: 'cashier' }
    for (const seed of [
      "INSERT INTO products(id,image_path) VALUES(1,'/uploads/old10.webp')",
      "INSERT INTO product_images(id,image_path) VALUES(1,'/uploads/old10.webp')",
      "INSERT INTO promotions(id,image_path) VALUES(1,'/uploads/old10.webp?v=2')",
      "INSERT INTO settings(key,value) VALUES('store_logo','{\"logo\":\"/uploads/old10.webp\"}')",
    ]) {
      reset()
      db.prepare(seed).run()
      const { status } = await put(2, '/uploads/new20.webp')
      assert.equal(status, 200, seed)
      assert.equal(avatarOf(2), '/uploads/new20.webp', seed)
      assert.deepEqual(r2Deleted, [], seed)
      assert.equal(assetExists(10), true, seed)
    }
  })

  await check('a general library file that was the photo is never deleted, only replaced', async () => {
    db.prepare("UPDATE users SET avatar_path = '/uploads/lib11.jpg' WHERE id = 2").run()
    actor = { id: 2, username: 'cashier' }
    assert.equal((await put(2, '/uploads/new20.webp')).status, 200)
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(11), true)
  })

  await check('re-setting the same path is a no-op: no delete, no write, no audit', async () => {
    db.prepare("UPDATE users SET updated_at = '2026-09-01 00:00:00' WHERE id = 2").run()
    actor = { id: 2, username: 'cashier' }
    const { status, body } = await put(2, '/uploads/old10.webp')
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(avatarOf(2), '/uploads/old10.webp')
    assert.deepEqual(r2Deleted, [])
    assert.equal(assetExists(10), true)
    assert.equal(audits.length, 0)
    assert.equal(db.prepare('SELECT updated_at FROM users WHERE id = 2').get({}).updated_at, '2026-09-01 00:00:00')
  })

  await check('control: a first photo (nothing before) deletes nothing', async () => {
    actor = { id: 3, username: 'manager' }
    assert.equal((await put(3, '/uploads/new20.webp')).status, 200)
    assert.deepEqual(r2Deleted, [])
  })

  await check('users.ts keeps ONE avatar reference check, shared by PUT and DELETE', async () => {
    const source = fs.readFileSync(usersSource, 'utf8')
    const refChecks = source.match(/FROM product_images WHERE image_path = @path/g) || []
    assert.equal(refChecks.length, 1, 'a second copy of the reference check was written')
    const putBlock = source.slice(source.indexOf("app.put('/users/:id/avatar'"), source.indexOf("app.delete('/users/:id/avatar'"))
    const deleteBlock = source.slice(source.indexOf("app.delete('/users/:id/avatar'"), source.indexOf('// -- User CRUD'))
    assert.match(putBlock, /deleteOrphanAvatarObject\(c, previousPath, 'avatar_replaced'\)/)
    assert.match(deleteBlock, /deleteOrphanAvatarObject\(c, previousPath, 'avatar_removed'\)/)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
