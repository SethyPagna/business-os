// E6 (5 Oct 2026): GET /api/users/password-hash-status -- the Workers Free
// readiness check. Before the plan move the lead confirms every ACTIVE staff
// account holds a current PBKDF2 hash (a legacy bcrypt check costs far more
// CPU than Free allows).
//
// Drives the REAL routes/users.ts, lib/passwordHash.ts and lib/permissions.ts
// over in-memory SQLite built from every real migration. Pins:
//   - administrators only (a cashier gets 403);
//   - each staff hash is classified by its own prefix: current, legacy
//     bcrypt, another PBKDF2 count, unknown; deleted accounts are not counted;
//   - readyForFree is false while an ACTIVE account is legacy bcrypt and true
//     once only inactive ones are (they cannot sign in);
//   - pending names the accounts still to upgrade and never carries a hash;
//   - storefront accounts are counts only;
//   - a real hashPassword row counts as current (prefix and module agree);
//   - pepper: pepperConfigured reports whether PASSWORD_PEPPER is set (never
//     its value); once set, unpeppered rows stop counting as current until a
//     sign-in rewrites them, and the storefront SQL tells peppered from
//     unpeppered rows that share a prefix.
//
// Run: node scripts/test-password-hash-status-route-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const bcrypt = require('bcryptjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function load(rel, overrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', rel)
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

const permissions = load('lib/permissions.ts')
const passwordHash = load('lib/passwordHash.ts')
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
let db

function sessionUser(id) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.role_id, u.permissions, u.is_active,
           r.code AS role_code, r.permissions AS role_permissions, r.name AS role_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = @id AND u.is_active = 1 AND u.deleted_at IS NULL
  `).get({ id })
  return row ? { ...row } : null
}

const app = load('routes/users.ts', {
  '../lib/imageAudit': { enqueueImageNormalization: noop },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser(Number(c.req.header('x-actor')))); return next() }, revokeUserSessions: noop },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), audit: noop },
  '../lib/permissions': permissions,
  '../lib/adminControlGuard': load('lib/adminControlGuard.ts', { './permissions': permissions }),
  '../lib/conflictControl': load('lib/conflictControl.ts'),
  '../durable-objects/broadcastHub': { broadcast: noop },
  '../lib/cache': { bumpVersion: noop },
  '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'x', verifyCurrentPassword: async () => ({ ok: true }) },
  '../lib/passwordPolicy': load('lib/passwordPolicy.ts'),
  '../lib/passwordHash': passwordHash,
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const PEPPER = 'c0de'.repeat(16)
async function get(actor, extraEnv = {}) {
  const res = await app.request('/users/password-hash-status', { method: 'GET', headers: { 'x-actor': String(actor) } }, { DB: db, ...extraEnv }, ctx)
  return { status: res.status, body: await res.json() }
}

async function main() {
  db = openDb(loadAll())
  const current = await passwordHash.hashPassword('owner-pass-1')
  const otherCount = current.replace('$i=10000$', '$i=20000$')
  const legacy = bcrypt.hashSync('pw', 4)
  db.prepare(`INSERT INTO roles(id,name,code,permissions,is_system) VALUES
    (1,'Admin','admin','{"all":true}',1), (2,'Employee','employee','{"sales":true}',0)`).run()
  const insert = db.prepare('INSERT INTO users(id,username,name,password,role_id,permissions,is_active,deleted_at) VALUES (@id,@u,@u,@p,@role,\'{}\',@active,@deleted)')
  insert.run({ id: 1, u: 'owner', p: current, role: 1, active: 1, deleted: null })
  insert.run({ id: 2, u: 'cashier', p: legacy, role: 2, active: 1, deleted: null })
  insert.run({ id: 3, u: 'retired', p: legacy, role: 2, active: 0, deleted: null })
  insert.run({ id: 4, u: 'tuned', p: otherCount, role: 2, active: 1, deleted: null })
  insert.run({ id: 5, u: 'odd', p: 'not-a-hash', role: 2, active: 1, deleted: null })
  insert.run({ id: 6, u: 'removed', p: legacy, role: 2, active: 1, deleted: '2026-09-01T00:00:00.000Z' })
  const portal = db.prepare("INSERT INTO portal_accounts (membership_id, name, phone, password_hash) VALUES (@m, @n, @ph, @h)")
  portal.run({ m: 'LC-1', n: 'A', ph: '011000001', h: await passwordHash.hashPassword('x-pass-1') })
  portal.run({ m: 'LC-2', n: 'B', ph: '011000002', h: legacy })
  portal.run({ m: 'LC-3', n: 'C', ph: '011000003', h: legacy.replace('$2b$', '$2a$') })

  const refused = await get(2)
  assert.equal(refused.status, 403, 'a cashier cannot read it')

  const res = await get(1)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(res.body.target, { algorithm: 'pbkdf2-sha256', iterations: 10000, pepperVersion: null })
  assert.equal(res.body.pepperConfigured, false, 'no PASSWORD_PEPPER: reported, nobody locked out')
  const { pending, ...counts } = res.body.staff
  assert.deepEqual(counts, { total: 5, current: 1, legacyBcrypt: 2, otherPbkdf2: 1, unknown: 1, activeLegacyBcrypt: 1, unpeppered: 2, readyForFree: false })
  assert.deepEqual(pending.map((p) => [p.username, p.isActive, p.scheme]), [
    ['cashier', true, 'bcrypt'], ['retired', false, 'bcrypt'], ['tuned', true, 'pbkdf2-sha256'], ['odd', true, 'unknown'],
  ])
  const text = JSON.stringify(res.body)
  assert.ok(!text.includes('$2') && !text.includes('$pbkdf2-sha256$i='), 'no hash material in the answer')
  assert.deepEqual(res.body.portal, { total: 3, current: 1, legacyBcrypt: 2, unpeppered: 1 })

  // The cashier signs in (the login upgrade); only an inactive legacy row is left.
  db.prepare('UPDATE users SET password = @p WHERE id = 2').run({ p: await passwordHash.hashPassword('pw') })
  const after = await get(1)
  assert.equal(after.body.staff.activeLegacyBcrypt, 0)
  assert.equal(after.body.staff.readyForFree, true, 'an inactive legacy account does not block the move')
  assert.equal(after.body.staff.current, 2)

  // A peppered storefront row shares the unpeppered current prefix; without a
  // pepper it must not count as current.
  const pepperEnv = { PASSWORD_PEPPER: PEPPER }
  portal.run({ m: 'LC-4', n: 'D', ph: '011000004', h: await passwordHash.hashPassword('y-pass-1', pepperEnv) })
  assert.deepEqual((await get(1)).body.portal, { total: 4, current: 1, legacyBcrypt: 2, unpeppered: 1 })

  // PASSWORD_PEPPER set: reported, and unpeppered rows are no longer current.
  const peppered = await get(1, pepperEnv)
  assert.equal(peppered.body.pepperConfigured, true)
  assert.equal(peppered.body.target.pepperVersion, 1)
  assert.ok(!JSON.stringify(peppered.body).includes(PEPPER), 'the pepper value never appears')
  assert.equal(peppered.body.staff.current, 0, 'unpeppered staff rows wait for their next sign-in')
  assert.equal(peppered.body.staff.unpeppered, 3)
  assert.equal(peppered.body.staff.readyForFree, true, 'the Free check is about bcrypt only')
  assert.deepEqual(peppered.body.portal, { total: 4, current: 1, legacyBcrypt: 2, unpeppered: 1 })
  // The owner signs in: the upgrade writes a peppered row.
  const ownerRow = db.prepare('SELECT password FROM users WHERE id = 1').get().password
  assert.equal(await passwordHash.upgradePasswordHash({ prepare: (sql) => ({ run: async (p) => ({ changes: Number(db.prepare(sql).run(p).meta?.changes ?? 0) }) }) }, 'users', 1, 'owner-pass-1', ownerRow, pepperEnv), true)
  const afterOwner = await get(1, pepperEnv)
  assert.equal(afterOwner.body.staff.current, 1)
  assert.equal(afterOwner.body.staff.unpeppered, 2)

  console.log('test-password-hash-status-route-pure: all assertions passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
