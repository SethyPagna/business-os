// U-profile3 (27 Sep 2026), refuter findings X1/X2. Owner rule: nothing may
// be lost and everything must be recoverable.
//
// Before: PUT /users/:id/avatar (replace) and DELETE /users/:id/avatar
// deleted the old R2 object and its file_assets row whenever their own
// canonical-only reference count found nothing -- so a promotion showing the
// photo as `uploads/NAME`, `/uploads/NAME?v=3`, another user's avatar as an
// absolute URL, a relative setting / product cover, or a pending import
// match lost its image. The Library delete (routes/files.ts) missed several
// of the same forms.
//
// Drives the REAL routes/users.ts and routes/files.ts over an in-memory
// SQLite built from EVERY migration, with a recording fake R2, and pins:
//   - avatar replace and remove NEVER delete an object or file_assets row;
//     they move the pointer and audit the old path (the refuter's RP1-RP15
//     and D1-D17 cases);
//   - the Library delete refuses (409) a file referenced in any stored form
//     (the same reference forms), and still deletes an unreferenced one
//     (positive control) and one whose name only LOOKS similar (negative
//     control);
//   - lib/uploadReferences.ts normalises every form the header lists.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

function load(rel, overrides = {}) {
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (request) => {
      if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
      if (request.startsWith('.')) throw new Error(`unstubbed relative import ${request} from ${rel}`)
      return require(request)
    },
    mod, mod.exports, sourcePath, path.dirname(sourcePath),
  )
  return mod.exports
}

function freshDb() {
  const d1 = openDb(loadAll())
  // lib/db.ts run() answers { changes, lastInsertRowid }; the harness fills meta only.
  const prepare = d1.prepare.bind(d1)
  d1.prepare = (sql) => {
    const st = prepare(sql)
    const run = st.run.bind(st)
    st.run = (p) => { const r = run(p); r.changes = r.meta.changes; r.lastInsertRowid = Number(r.meta.last_row_id); return r }
    return st
  }
  return d1
}

const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
let actor = null
let audits = []
const dbMod = { getDb: (env) => env.DB }
const permissions = load('lib/permissions.ts')
const fileAssets = load('lib/fileAssets.ts')
const uploadSecurity = load('lib/uploadSecurity.ts')
const uploadReferences = load('lib/uploadReferences.ts')
const common = {
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': dbMod,
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() }, revokeUserSessions: noop },
  '../lib/audit': {
    audit: async (...args) => { audits.push(args) },
    changedFields: (before, after) => ({ before, after }),
    auditChangeColumns: () => ({}),
  },
  '../lib/permissions': permissions,
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': fileAssets,
  '../lib/uploadSecurity': uploadSecurity,
  '../lib/uploadReferences': uploadReferences,
  '../lib/rateLimit': {
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0, slot: 'x' }),
    releaseRateLimitSlot: noop,
    getClientIp: () => '127.0.0.1',
  },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.', verifyCurrentPassword: async (_c, _who, plain, hash) => (false ? { ok: true } : { ok: false, rateLimited: false }) },
  '../index': {},
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
}
const usersRoute = load('routes/users.ts', {
  ...common,
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/conflictControl': { assertUpdatedAtMatch: () => {}, getExpectedUpdatedAt: () => null, writeConflictResponse: () => ({}), WriteConflictError: class {} },
  '../lib/passwordPolicy': load('lib/passwordPolicy.ts'),
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
}).default
const filesRoute = load('routes/files.ts', {
  ...common,
  '../lib/imagePipeline': { optimizeImage: async () => null, IMAGE_MAX_BYTES: 8 * 1024 * 1024 },
  '../lib/libraryLogicalAssets': load('lib/libraryLogicalAssets.ts', { './fileAssets': fileAssets }),
  '../lib/media': load('lib/media.ts'),
  '../lib/sqlBinding': load('lib/sqlBinding.ts'),
}).default

let db
let r2
let env
let nextId
const OWNER = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}' }
const CASHIER = { id: 2, username: 'cashier', name: 'Cashier', role_code: 'cashier', permissions: '{}' }

// Building every migration takes ~2s, so the schema is built once and each
// case empties the tables it seeds.
const RESET_TABLES = [
  'audit_logs', 'product_images', 'products', 'promotions', 'settings', 'import_job_image_matches', 'import_job_files',
  'import_jobs', 'customer_share_submissions', 'pending_actions', 'file_assets', 'users', 'roles',
]
function reset() {
  db = db || freshDb()
  for (const table of RESET_TABLES) db.prepare(`DELETE FROM ${table}`).run({})
  r2 ={ deletes: [], async put() {}, async delete(key) { this.deletes.push(key) } }
  env = { DB: db, ASSETS: r2 }
  audits = []
  nextId = 200
  db.prepare("INSERT INTO roles(id,name,permissions,code) VALUES (1,'Admin','{}','admin'),(2,'Cashier','{}','cashier')").run({})
  const insertUser = db.prepare('INSERT INTO users(id,username,name,password,role_id,is_active) VALUES (@id,@u,@u,@pw,@r,1)')
  insertUser.run({ id: 1, u: 'owner', pw: 'x', r: 1 })
  insertUser.run({ id: 2, u: 'cashier', pw: 'x', r: 2 })
  insertUser.run({ id: 3, u: 'manager', pw: 'x', r: 2 })
}

// Every current writer names objects `<base>-<ms>-<8 hex>.<ext>`.
function asset(source = 'avatar', name) {
  const id = nextId++
  const storedName = name || `photo-${id}-1727400000${String(id).padStart(3, '0')}-ab12cd34.png`
  db.prepare("INSERT INTO file_assets(id,original_name,stored_name,public_path,mime_type,media_type,source) VALUES (@id,@n,@n,@pp,'image/png','image',@s)")
    .run({ id, n: storedName, pp: `/uploads/${storedName}`, s: source })
  return { id, name: storedName, p: `/uploads/${storedName}` }
}
const assetRow = (id) => db.prepare('SELECT id FROM file_assets WHERE id = @id').get({ id })
const avatarOf = (id) => db.prepare('SELECT avatar_path AS a FROM users WHERE id = @id').get({ id }).a

async function call(app, method, url, body) {
  const res = await app.request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }, env, ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { status: res.status, json }
}

// The reference forms the refuter found deleted (D3-D17, RP2-RP12), plus the
// encoded / JSON-escaped / variant forms the one rule also normalises.
const promo = (v) => db.prepare("INSERT INTO promotions(title,image_path) VALUES ('promo',@v)").run({ v })
const prod = (v) => db.prepare('INSERT INTO products(name,image_path,is_active) VALUES (@n,@v,1)').run({ n: `P${nextId++}`, v })
const setting = (v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (@k,@v)').run({ k: `k_${nextId++}`, v })
const manager = (v) => db.prepare('UPDATE users SET avatar_path = @v WHERE id = 3').run({ v })
const REFERENCE_FORMS = [
  ['another user, exact path', (a) => manager(a.p)],
  ['another user, PATH?v=1 (admin free-text avatar field)', (a) => manager(`${a.p}?v=1`)],
  ['another user, absolute URL', (a) => manager(`https://admin.leangbeauty.com${a.p}`)],
  ['another user, relative uploads/NAME', (a) => manager(a.p.slice(1))],
  ['product cover exact', (a) => prod(a.p)],
  ['product cover on an INACTIVE product', (a) => db.prepare('INSERT INTO products(name,image_path,is_active) VALUES (@n,@v,0)').run({ n: `Pi${nextId++}`, v: a.p })],
  ['product cover relative', (a) => prod(a.p.slice(1))],
  ['product gallery row', (a) => { const r = prod('/uploads/other.png'); db.prepare('INSERT INTO product_images(product_id,image_path) VALUES (@pid,@v)').run({ pid: Number(r.meta.last_row_id), v: a.p }) }],
  ['promotion exact', (a) => promo(a.p)],
  ['promotion ?v=3', (a) => promo(`${a.p}?v=3`)],
  ['promotion RELATIVE uploads/NAME (D8/RP7)', (a) => promo(a.p.slice(1))],
  ['promotion RELATIVE + ?v=3 (D9/RP8)', (a) => promo(`${a.p.slice(1)}?v=3`)],
  ['promotion #hash', (a) => promo(`${a.p}#x`)],
  ['promotion link_url absolute', (a) => db.prepare("INSERT INTO promotions(title,link_url) VALUES ('promo',@v)").run({ v: `https://leangbeauty.com${a.p}` })],
  ['settings JSON (portal logo)', (a) => setting(JSON.stringify({ logo: a.p }))],
  ['settings JSON with escaped slashes', (a) => setting(JSON.stringify({ logo: a.p }).replace(/\//g, '\\/'))],
  ['settings absolute URL', (a) => setting(`https://admin.leangbeauty.com${a.p}`)],
  ['settings RELATIVE (D13/RP9)', (a) => setting(a.p.slice(1))],
  ['settings percent-encoded separator', (a) => setting(`uploads%2F${a.name}`)],
  ['image variant URL', (a) => setting(`/uploads/_v/w320/${a.name}`)],
  ['pending import match (D15/RP12)', (a) => db.prepare("INSERT INTO import_job_image_matches(job_id,row_number,image_path) VALUES ('job-1',@r,@v)").run({ r: nextId++, v: a.p })],
  ['customer share screenshots (D16)', (a) => db.prepare("INSERT INTO customer_share_submissions(customer_name,screenshots_json) VALUES ('c',@v)").run({ v: JSON.stringify([a.p]) })],
  ['product description mentions it (D17)', (a) => db.prepare('INSERT INTO products(name,description,is_active) VALUES (@n,@d,1)').run({ n: `Pd${nextId++}`, d: `see ${a.p}` })],
]

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  // -- avatar routes never delete -------------------------------------------
  await check('replace (RP1): an unshared avatar upload is kept; pointer moved; audit keeps the old path', async () => {
    const old = asset(); const next = asset()
    manager(null)
    db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: old.p })
    actor = CASHIER
    const r = await call(usersRoute, 'PUT', '/users/2/avatar', { avatar_path: next.p })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(avatarOf(2), next.p)
    assert.deepEqual(r2.deletes, [], 'no R2 object deleted')
    assert.ok(assetRow(old.id), 'the old photo stays in the Library')
    assert.equal(audits.filter((a) => a[4] === 'file').length, 0, 'no file-delete audit')
    const pointer = audits.find((a) => a[3] === 'update' && a[4] === 'user')
    assert.deepEqual(pointer[7], { before: { avatar_path: old.p }, after: { avatar_path: next.p } }, 'the old path is recoverable from the audit')
  })

  await check('replace by an admin (RP15) and of a library upload (RP14) delete nothing', async () => {
    for (const source of ['avatar', 'upload']) {
      const old = asset(source); const next = asset()
      db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: old.p })
      actor = OWNER
      assert.equal((await call(usersRoute, 'PUT', '/users/2/avatar', { avatar_path: next.p })).status, 200)
      assert.deepEqual(r2.deletes, [], source)
      assert.ok(assetRow(old.id), source)
    }
  })

  // Each form is tried and every loss is listed, so a red run names them all.
  await check('replace keeps the old photo under every reference form (RP2-RP12)', async () => {
    const lost = []
    for (const [label, seed] of REFERENCE_FORMS) {
      reset()
      const old = asset(); const next = asset()
      db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: old.p })
      seed(old)
      actor = CASHIER
      const r = await call(usersRoute, 'PUT', '/users/2/avatar', { avatar_path: next.p })
      assert.equal(r.status, 200, label)
      assert.equal(avatarOf(2), next.p, label)
      if (r2.deletes.length || !assetRow(old.id)) lost.push(label)
    }
    assert.deepEqual(lost, [], 'replace deleted a photo still referenced as')
  })

  await check('remove (D1): clears the pointer, keeps the object, audits the old path', async () => {
    const old = asset()
    db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: old.p })
    actor = CASHIER
    const r = await call(usersRoute, 'DELETE', '/users/2/avatar')
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.removed, true)
    assert.equal(avatarOf(2), null)
    assert.deepEqual(r2.deletes, [])
    assert.ok(assetRow(old.id))
    const pointer = audits.find((a) => a[3] === 'update' && a[4] === 'user')
    assert.ok(pointer, 'the pointer change is audited (M15)')
    assert.deepEqual(pointer[7], { before: { avatar_path: old.p }, after: { avatar_path: null } })
  })

  await check('remove keeps the photo under every reference form (D2-D17)', async () => {
    const lost = []
    for (const [label, seed] of REFERENCE_FORMS) {
      reset()
      const old = asset()
      db.prepare('UPDATE users SET avatar_path = @p WHERE id = 2').run({ p: old.p })
      seed(old)
      actor = CASHIER
      const r = await call(usersRoute, 'DELETE', '/users/2/avatar')
      assert.equal(r.status, 200, label)
      assert.equal(avatarOf(2), null, label)
      if (r2.deletes.length || !assetRow(old.id)) lost.push(label)
    }
    assert.deepEqual(lost, [], 'remove deleted a photo still referenced as')
  })

  // -- the Library delete uses the one reference rule -----------------------
  await check('Library delete refuses (409) a file referenced in any stored form, and deletes nothing', async () => {
    const lost = []
    for (const [label, seed] of REFERENCE_FORMS) {
      reset()
      const a = asset()
      seed(a)
      actor = OWNER
      const r = await call(filesRoute, 'DELETE', `/${a.id}`, {})
      if (r.status !== 409 || r2.deletes.length || !assetRow(a.id)) { lost.push(label); continue }
      assert.equal(r.json.forceable, true, label)
      assert.ok(Object.values(r.json.usage).some((n) => n > 0), `${label}: usage names the reference`)
    }
    assert.deepEqual(lost, [], 'the Library deleted a file still referenced as')
  })

  await check('Library delete: a legacy Khmer / spaced name is found in its percent-encoded and +-encoded forms', async () => {
    for (const form of [(n) => `/uploads/${encodeURIComponent(n)}`, (n) => `uploads/${encodeURIComponent(n).toLowerCase()}`, (n) => `/uploads/${n.replace(/ /g, '+')}?v=2`]) {
      reset()
      const a = asset('upload', 'រូប ផលិតផល.png')
      promo(form(a.name))
      actor = OWNER
      const r = await call(filesRoute, 'DELETE', `/${a.id}`, {})
      assert.equal(r.status, 409, form(a.name))
      assert.deepEqual(r2.deletes, [])
    }
  })

  await check('Library delete: a pending import file of an unfinished job counts; a finished job does not', async () => {
    const a = asset('import')
    db.prepare("INSERT INTO import_jobs(id,type,status) VALUES ('job-live','products','awaiting_review'),('job-done','products','completed')").run({})
    db.prepare("INSERT INTO import_job_files(job_id,kind,stored_path,file_asset_id) VALUES ('job-live','image',@k,@id)").run({ k: `uploads/${a.name}`, id: a.id })
    actor = OWNER
    assert.equal((await call(filesRoute, 'DELETE', `/${a.id}`, {})).status, 409)
    db.prepare("UPDATE import_job_files SET job_id = 'job-done'").run({})
    const r = await call(filesRoute, 'DELETE', `/${a.id}`, {})
    assert.equal(r.status, 200, JSON.stringify(r.json))
  })

  await check('Library delete control: an unreferenced file IS deleted (object + row)', async () => {
    const a = asset('upload')
    actor = OWNER
    const r = await call(filesRoute, 'DELETE', `/${a.id}`, {})
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(r2.deletes, [`uploads/${a.name}`])
    assert.equal(assetRow(a.id), undefined)
  })

  await check('Library delete control: a similarly named OTHER file does not pin this one', async () => {
    const a = asset('upload', 'banner-1727400000001-ab12cd34.png')
    promo('/uploads/banner-1727400000001-ab12cd35.png')
    promo('/uploads/xbanner-1727400000001-ab12cd34.png.bak/other')
    setting('see uploads/banner-1727400000001-ab12cd3.png')
    actor = OWNER
    const r = await call(filesRoute, 'DELETE', `/${a.id}`, {})
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.deepEqual(r2.deletes, [`uploads/${a.name}`])
  })

  await check('Library delete: the typed CONFIRM DELETE override still works on a referenced file', async () => {
    const a = asset('upload')
    promo(a.p.slice(1))
    actor = OWNER
    const r = await call(filesRoute, 'DELETE', `/${a.id}`, { force: true, confirmText: 'CONFIRM DELETE' })
    assert.equal(r.status, 200)
    const record = audits.find((x) => x[3] === 'delete' && x[4] === 'file')
    assert.equal(record[6].forced, true)
    assert.equal(record[6].usage.promotions, 1)
  })

  // -- the normaliser itself ------------------------------------------------
  await check('valueReferencesUpload normalises scheme/host, query, hash, missing slash, encoding, JSON escapes', () => {
    const a = { stored_name: 'x-1727400000000-ab12cd34.png', public_path: '/uploads/x-1727400000000-ab12cd34.png' }
    const yes = [
      '/uploads/x-1727400000000-ab12cd34.png', 'uploads/x-1727400000000-ab12cd34.png',
      '/uploads/x-1727400000000-ab12cd34.png?v=3', 'uploads/x-1727400000000-ab12cd34.png#top',
      'https://admin.leangbeauty.com/uploads/x-1727400000000-ab12cd34.png?v=1',
      '{"logo":"\\/uploads\\/x-1727400000000-ab12cd34.png"}', 'uploads%2Fx-1727400000000-ab12cd34.png',
      '/uploads/_v/w320/x-1727400000000-ab12cd34.png', '<img src="/uploads/x-1727400000000-ab12cd34.png">',
    ]
    const no = [null, '', '/uploads/x-1727400000000-ab12cd35.png', 'x-1727400000000-ab12cd34.png is a name, not a path', '/uploads/y-1727400000000-ab12cd34.png']
    for (const v of yes) assert.equal(uploadReferences.valueReferencesUpload(v, a), true, v)
    for (const v of no) assert.equal(uploadReferences.valueReferencesUpload(v, a), false, String(v))
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
