// Drives the real users route against real in-memory SQLite for role edits.
// It proves the pre-read version check is backed by an in-batch compare-and-
// swap, and that the winning role update and its audit row commit atomically.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const SCHEMA = `
  CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    permissions TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    code TEXT,
    is_system INTEGER DEFAULT 0,
    updated_at TEXT
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    permissions TEXT DEFAULT '{}'
  );
  CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    device_name TEXT,
    device_tz TEXT,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT
  );
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    table_name TEXT,
    record_id TEXT,
    new_value TEXT,
    device_name TEXT,
    device_tz TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`

const INITIAL_VERSION = '2026-09-03 05:34:30'
const INITIAL_PERMISSIONS = JSON.stringify({ sales: true, pos: true })
const USER_OVERRIDES = JSON.stringify({ 'sales:cancel': false, 'sales:status': true })
const ACTOR = { id: 91, username: 'owner', name: 'Business Owner', isAdmin: true }

let db
let currentActor
let broadcasts
let legacyAuditCalls

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

const conflictControl = load('lib/conflictControl.ts')
const usersRoute = load('routes/users.ts', {
  hono: require('hono'),
  bcryptjs: { hashSync: () => 'hash', compareSync: () => true },
  '../lib/imageAudit': { enqueueImageNormalization: async () => {} },
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/userIdentity': { buildUserRenameStatements: () => [] },
  '../lib/auth': {
    requireAuth: async (c, next) => { c.set('user', currentActor); return next() },
    revokeUserSessions: async () => {},
  },
  '../lib/audit': { audit: async () => { legacyAuditCalls += 1 } },
  '../lib/permissions': { isAdminControlUser: (actor) => actor?.isAdmin === true },
  '../lib/conflictControl': conflictControl,
  '../durable-objects/broadcastHub': {
    broadcast: async (...args) => { broadcasts.push(args) },
  },
  '../lib/cache': { bumpVersion: async () => {} },
  '../lib/fileAssets': {
    getMediaType: () => 'image', buildUniqueStoredName: (name) => name, sanitizeOriginalFileName: (name) => name,
  },
  '../lib/uploadSecurity': { validateUploadedBuffer: () => {} },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
  '../lib/passwordPolicy': { passwordTooShort: () => false, passwordMinLengthError: () => '' },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (actor) => actor?.username || null },
})
const app = usersRoute.default
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }

function reset({ version = INITIAL_VERSION } = {}) {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO roles(id,name,permissions,code,is_system,updated_at)
              VALUES(3,'Employee',@permissions,'employee',0,@version),
                    (4,'Manager','{}','manager',1,@version)`).run({ permissions: INITIAL_PERMISSIONS, version })
  db.prepare('INSERT INTO users(id,username,name,permissions) VALUES(91,\'owner\',\'Business Owner\',@permissions)').run({ permissions: USER_OVERRIDES })
  db.prepare(`INSERT INTO user_sessions(id,user_id,device_name,device_tz,last_seen_at,revoked_at)
              VALUES(1,91,'Owner laptop','Asia/Phnom_Penh','2026-09-09 01:00:00',NULL)`).run()
  currentActor = { ...ACTOR }
  broadcasts = []
  legacyAuditCalls = 0
}

function racingDb(beforeBatch) {
  let pending = beforeBatch
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get staging() { return this },
    async batch(statements) {
      if (pending) {
        const inject = pending
        pending = null
        await inject(db)
      }
      return db.batch(statements)
    },
  }
}

async function updateRole(body, database = db, id = 3) {
  const response = await app.request(`/roles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: database }, executionCtx)
  return { status: response.status, body: await response.json() }
}

function role(id = 3) {
  return db.prepare('SELECT id,name,permissions,code,is_system,created_at,updated_at FROM roles WHERE id=@id').get({ id })
}

function audits() {
  return db.prepare("SELECT user_id,user_name,action,entity,entity_id,details,device_name,device_tz FROM audit_logs WHERE entity='role' ORDER BY id")
    .all().map((row) => ({ ...row }))
}

let passed = 0
async function check(name, fn, options) {
  reset(options)
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('matching version fully replaces role permissions and atomically records one audit', async () => {
    const permissions = { sales: true, pos: false, 'sales:cancel': 'review', custom: true }
    const result = await updateRole({ name: 'Employee', permissions, expectedUpdatedAt: INITIAL_VERSION })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(JSON.parse(role().permissions), permissions)
    assert.notEqual(role().updated_at, INITIAL_VERSION)
    assert.equal(db.prepare('SELECT permissions FROM users WHERE id=91').get().permissions, USER_OVERRIDES,
      'role replacement must not rewrite per-user permission overrides')
    assert.deepEqual(audits(), [{
      user_id: 91, user_name: 'owner', action: 'update', entity: 'role', entity_id: '3',
      details: JSON.stringify({ name: 'Employee' }), device_name: 'Owner laptop', device_tz: 'Asia/Phnom_Penh',
    }])
    assert.equal(legacyAuditCalls, 0, 'the best-effort out-of-batch audit helper must not be used')
    assert.equal(broadcasts.length, 1)
  })

  await check('stale client version is refused before any write side effect', async () => {
    const before = role()
    const result = await updateRole({ name: 'Stale', permissions: {}, expectedUpdatedAt: 'older' })
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.deepEqual(role(), before)
    assert.equal(audits().length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('an interposed same-version edit wins and the loser emits no audit or broadcast', async () => {
    const database = racingDb((raceDb) => raceDb.prepare(`
      UPDATE roles SET name='Concurrent Employee',permissions='{"concurrent":true}'
      WHERE id=3
    `).run())
    const result = await updateRole({
      name: 'Losing Employee', permissions: { losing: true }, expectedUpdatedAt: INITIAL_VERSION,
    }, database)
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(result.body.reason, 'updated')
    assert.equal(result.body.actualUpdatedAt, INITIAL_VERSION)
    assert.equal(role().name, 'Concurrent Employee')
    assert.deepEqual(JSON.parse(role().permissions), { concurrent: true })
    assert.equal(audits().length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('deletion after the pre-read returns the standard deleted conflict', async () => {
    const database = racingDb((raceDb) => raceDb.prepare('DELETE FROM roles WHERE id=3').run())
    const result = await updateRole({ name: 'Missing', permissions: {}, expectedUpdatedAt: INITIAL_VERSION }, database)
    assert.equal(result.status, 409, JSON.stringify(result.body))
    assert.equal(result.body.code, 'write_conflict')
    assert.equal(result.body.reason, 'deleted')
    assert.equal(result.body.current, null)
    assert.equal(role(), undefined)
    assert.equal(audits().length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('a NULL observed version is guarded NULL-safely and can update normally', async () => {
    const result = await updateRole({ name: 'Employee Null Version', permissions: { sales: true }, expectedUpdatedAt: null })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(role().name, 'Employee Null Version')
    assert.notEqual(role().updated_at, null)
    assert.equal(audits().length, 1)
    assert.equal(broadcasts.length, 1)
  }, { version: null })

  await check('audit insertion failure rolls back the role update and emits no broadcast', async () => {
    const before = role()
    db.exec(`CREATE TRIGGER reject_role_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity='role' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    const result = await updateRole({ name: 'Must Roll Back', permissions: { changed: true }, expectedUpdatedAt: INITIAL_VERSION })
    assert.equal(result.status, 500, JSON.stringify(result.body))
    assert.match(result.body.error, /audit failure/)
    assert.deepEqual(role(), before)
    assert.equal(audits().length, 0)
    assert.equal(broadcasts.length, 0)
  })

  await check('admin-only, system-role, and reserved-name guards still run before the batch', async () => {
    currentActor.isAdmin = false
    assert.equal((await updateRole({ name: 'Denied', permissions: {} })).status, 403)
    currentActor.isAdmin = true
    assert.equal((await updateRole({ name: 'Manager', permissions: {} }, db, 4)).status, 403)
    assert.equal((await updateRole({ name: '', permissions: {} })).status, 400)
    assert.equal((await updateRole({ name: 'Admin', permissions: {} })).status, 400)
    assert.equal(audits().length, 0)
    assert.equal(broadcasts.length, 0)
  })

  console.log(`\n${passed} role update concurrency checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
