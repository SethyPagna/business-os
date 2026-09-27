// FX-sec2 item 3 (refuter R-sec F3): the owner could lock everyone out.
//
// Administrator control comes from the admin role or an effective `all` grant
// (lib/permissions.ts isAdminControlUser), never from the username. Before this
// guard, the sole administrator could move themself to Employee (or lose `all`,
// or be deactivated or deleted, or have their custom role's `all` removed) and
// the write saved -- after which every user and role route answered 403 and
// nothing in the app could repair it (R-sec probe: PUT role_id=2 -> 200, then
// PUT role_id=1 back -> 403, GET /users -> 403).
//
// Drives the REAL routes/users.ts, lib/adminControlGuard.ts, lib/permissions.ts
// and lib/conflictControl.ts over in-memory SQLite built from every real
// migration. The session user is built the way lib/auth.ts builds it (users
// LEFT JOIN roles; only active, non-deleted accounts sign in).
//   Refusals: every writer that would leave zero ACTIVE, non-deleted
//     administrators answers 409 `code: 'last_admin_required'` and saves nothing.
//   Controls: demoting one of two administrators, deactivating a non-admin,
//     an unrelated edit to the sole administrator, and a role edit while
//     another administrator remains all still save.
//   Races: two writes that each leave an administrator on their own but none
//     together (two admins demoting each other; a user demotion interleaved
//     with a role edit) -- exactly one commits.
//
// Run: node scripts/test-last-admin-guard-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
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
const noop = async () => {}
const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }
const MIGRATIONS = loadAll()

let db
// The session user exactly as lib/auth.ts's lookupSessionUser builds it.
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
  // Real module (pure, no imports): a hand-rolled stub lags every member the route starts importing.
  '../lib/passwordPolicy': load('lib/passwordPolicy.ts'),
  '../lib/googleOauth': { isGoogleLinkReady: () => false },
  '../index': {},
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
}).default

const ADMIN_ROLE = 1
const EMPLOYEE_ROLE = 2
const OWNERS_ROLE = 3 // a custom role granting `all`
const OWNER = 1
const CASHIER = 2

// One active administrator (the owner, renamed away from "admin"), one
// cashier, plus an administrator who is deactivated and one who is deleted:
// neither of those can sign in, so neither may count.
function reset({ ownerRole = ADMIN_ROLE, ownerPermissions = '{}' } = {}) {
  db = openDb(MIGRATIONS)
  db.prepare(`INSERT INTO roles(id,name,code,permissions,is_system) VALUES
    (1,'Admin','admin','{"all":true}',1),
    (2,'Employee','employee','{"sales":true}',0),
    (3,'Owners',NULL,'{"all":true}',0)`).run()
  db.prepare(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active,deleted_at) VALUES
    (1,'owner','Owner','x',@ownerRole,@ownerPermissions,1,NULL),
    (2,'cashier','Cashier','x',2,'{}',1,NULL),
    (3,'retired','Retired Admin','x',1,'{}',0,NULL),
    (4,'removed','Removed Admin','x',1,'{}',1,'2026-09-01T00:00:00.000Z')`).run({ ownerRole, ownerPermissions })
}

function addUser(id, username, roleId, userPermissions = '{}') {
  db.prepare(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES (@id,@username,@name,'x',@roleId,@userPermissions,1)`)
    .run({ id, username, name: username, roleId, userPermissions })
}

async function call(method, url, body, actor = OWNER, database = db) {
  const res = await app.request(url, {
    method, headers: { 'Content-Type': 'application/json', 'x-actor': String(actor) }, body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: database }, ctx)
  return { status: res.status, body: await res.json() }
}

const userRow = (id) => ({ ...db.prepare('SELECT role_id, permissions, is_active, deleted_at, name FROM users WHERE id = @id').get({ id }) })
const rolePermissions = (id) => db.prepare('SELECT permissions FROM roles WHERE id = @id').get({ id }).permissions
const activeAdminIds = () => db.prepare('SELECT id FROM users').all().map((row) => row.id)
  .filter((id) => permissions.isAdminControlUser(sessionUser(id)))

function assertRefused(res, label) {
  assert.equal(res.status, 409, `${label}: ${JSON.stringify(res.body)}`)
  assert.equal(res.body.code, 'last_admin_required', label)
  assert.equal(res.body.success, false, label)
}

// Holds every party's batch until all have planned, so every write is decided
// on the same snapshot -- the race the commit-time re-check closes -- then
// commits them in party order (0 first), so each order is tested on purpose.
function barrier(parties) {
  let arrived = 0
  let releaseAll
  const all = new Promise((resolve) => { releaseAll = resolve })
  const turns = Array.from({ length: parties }, () => {
    let open
    const ready = new Promise((resolve) => { open = resolve })
    return { ready, open }
  })
  turns[0].open()
  // A party that never reaches its batch must not hang the others.
  const timer = setTimeout(() => { releaseAll(); turns.forEach((turn) => turn.open()) }, 2000)
  return {
    arrivals: () => arrived,
    party: (index) => ({
      prepare: (sql) => db.prepare(sql),
      exec: (sql) => db.exec(sql),
      get staging() { return this },
      async batch(statements) {
        arrived += 1
        if (arrived >= parties) { clearTimeout(timer); releaseAll() }
        await all
        await turns[index].ready
        try { return await db.batch(statements) } finally { turns[index + 1]?.open() }
      },
    }),
  }
}

let failures = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  // ---- Refusals ------------------------------------------------------------
  await check('the sole administrator cannot move themself to Employee, and can still manage users afterwards', async () => {
    reset()
    assert.deepEqual(activeAdminIds(), [OWNER], 'fixture: the retired and removed admins do not count')
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE }), 'self-demotion')
    assert.equal(userRow(OWNER).role_id, ADMIN_ROLE, 'nothing was saved')
    assert.equal((await call('GET', '/users')).status, 200, 'the owner is not locked out')
    assert.equal((await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: ADMIN_ROLE })).status, 200)
  })

  await check('a user-level all:false on the sole administrator (custom all role) is refused', async () => {
    reset({ ownerRole: OWNERS_ROLE })
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: OWNERS_ROLE, permissions: { all: false } }), 'all:false')
    assert.equal(userRow(OWNER).permissions, '{}')
  })

  await check('removing a user-level all grant from the sole administrator is refused', async () => {
    reset({ ownerRole: EMPLOYEE_ROLE, ownerPermissions: '{"all":true}' })
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE, permissions: { sales: true } }), 'grant removal')
    assert.equal(userRow(OWNER).permissions, '{"all":true}')
  })

  await check('deactivating the sole administrator is refused', async () => {
    reset()
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: ADMIN_ROLE, is_active: 0 }), 'deactivate')
    assert.equal(userRow(OWNER).is_active, 1)
  })

  await check('deleting the sole administrator is refused', async () => {
    reset()
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: ADMIN_ROLE, delete_user: true }), 'delete')
    assert.equal(userRow(OWNER).deleted_at, null)
    assert.equal(userRow(OWNER).is_active, 1)
  })

  await check('removing `all` from a custom role the remaining administrators hold is refused', async () => {
    reset({ ownerRole: OWNERS_ROLE })
    assertRefused(await call('PUT', '/roles/3', { name: 'Owners', permissions: { sales: true } }), 'role edit')
    assert.equal(rolePermissions(OWNERS_ROLE), '{"all":true}')
    assert.equal((await call('GET', '/users')).status, 200)
  })

  await check('a role code is never writable, and the admin role itself cannot be edited', async () => {
    reset({ ownerRole: OWNERS_ROLE })
    const res = await call('PUT', '/roles/3', { name: 'Owners', code: 'employee', permissions: { all: true } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(db.prepare('SELECT code FROM roles WHERE id = 3').get().code, null, 'code in the body is ignored')
    reset()
    assert.equal((await call('PUT', '/roles/1', { name: 'Admin', permissions: {} })).status, 403)
    assert.equal(rolePermissions(ADMIN_ROLE), '{"all":true}')
  })

  // ---- Controls ------------------------------------------------------------
  await check('demoting one of two administrators is allowed; the last one is then protected', async () => {
    reset()
    addUser(5, 'second', ADMIN_ROLE)
    const res = await call('PUT', '/users/5', { username: 'second', name: 'second', role_id: EMPLOYEE_ROLE })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(userRow(5).role_id, EMPLOYEE_ROLE)
    assertRefused(await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE }), 'now the last')
  })

  await check('an administrator may step down while another administrator remains', async () => {
    reset()
    addUser(5, 'second', EMPLOYEE_ROLE, '{"all":true}') // administrator by grant, not by role
    const res = await call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(activeAdminIds(), [5])
  })

  await check('deactivating a non-admin is allowed', async () => {
    reset()
    const res = await call('PUT', '/users/2', { username: 'cashier', name: 'Cashier', role_id: EMPLOYEE_ROLE, is_active: 0 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(userRow(CASHIER).is_active, 0)
  })

  await check('an unrelated edit to the sole administrator still saves (role id sent as text too)', async () => {
    reset()
    let res = await call('PUT', '/users/1', { username: 'owner', name: 'Owner Renamed', role_id: ADMIN_ROLE })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(userRow(OWNER).name, 'Owner Renamed')
    res = await call('PUT', '/users/1', { username: 'owner', name: 'Owner Again', role_id: String(ADMIN_ROLE) })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(userRow(OWNER).name, 'Owner Again')
  })

  await check('promoting a cashier is allowed', async () => {
    reset()
    const res = await call('PUT', '/users/2', { username: 'cashier', name: 'Cashier', role_id: ADMIN_ROLE })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(activeAdminIds(), [OWNER, CASHIER])
  })

  await check('a role edit saves while another administrator remains, or while it keeps `all`', async () => {
    reset()
    addUser(5, 'second', OWNERS_ROLE)
    let res = await call('PUT', '/roles/3', { name: 'Owners', permissions: { sales: true } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(rolePermissions(OWNERS_ROLE), '{"sales":true}')
    reset({ ownerRole: OWNERS_ROLE })
    res = await call('PUT', '/roles/3', { name: 'Owners', permissions: { all: true, sales: true } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(rolePermissions(OWNERS_ROLE), '{"all":true,"sales":true}')
  })

  // ---- Races ---------------------------------------------------------------
  await check('two administrators demoting each other at the same moment: exactly one commits', async () => {
    reset()
    addUser(5, 'second', ADMIN_ROLE)
    const race = barrier(2)
    const [first, second] = await Promise.all([
      call('PUT', '/users/5', { username: 'second', name: 'second', role_id: EMPLOYEE_ROLE }, OWNER, race.party(0)),
      call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE }, 5, race.party(1)),
    ])
    assert.equal(race.arrivals(), 2, 'both writes planned on the same snapshot')
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assertRefused(second, 'the second commit')
    assert.equal(userRow(OWNER).role_id, ADMIN_ROLE, 'the refused demotion was rolled back')
    assert.deepEqual(activeAdminIds(), [OWNER])
  })

  for (const order of ['user demotion first', 'role edit first']) {
    await check(`a user demotion and a role edit interleaved (${order}): exactly one commits`, async () => {
      // The owner holds the admin role; "second" is an administrator only
      // through the custom Owners role. Each write alone leaves one of them.
      reset()
      addUser(5, 'second', OWNERS_ROLE)
      const race = barrier(2)
      const userFirst = order === 'user demotion first'
      const [demotion, roleEdit] = await Promise.all([
        call('PUT', '/users/1', { username: 'owner', name: 'Owner', role_id: EMPLOYEE_ROLE }, 5, race.party(userFirst ? 0 : 1)),
        call('PUT', '/roles/3', { name: 'Owners', permissions: { sales: true } }, OWNER, race.party(userFirst ? 1 : 0)),
      ])
      assert.equal(race.arrivals(), 2, 'both writes planned on the same snapshot')
      const [winner, loser] = userFirst ? [demotion, roleEdit] : [roleEdit, demotion]
      assert.equal(winner.status, 200, JSON.stringify(winner.body))
      assertRefused(loser, 'the second commit')
      assert.deepEqual(activeAdminIds(), userFirst ? [5] : [OWNER])
    })
  }

  if (failures) {
    console.error(`${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('all ok')
})().catch((error) => { console.error(error); process.exit(1) })
