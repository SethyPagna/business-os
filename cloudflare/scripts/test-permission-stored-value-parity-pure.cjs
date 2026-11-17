// A stored permission value must mean ONE thing to the Worker, the role editor, and the save route.
//
// The Worker reads a stored value strictly: a SECTION key ('products', 'pos', ...) is granted only by the boolean true (or by 'review' / 'view' on a key
// that carries that tier); an ACTION key ('products:delete') narrows only on the boolean false, every other value ("false", 0, null, "true", ...) is no
// opinion. The role editor used to read every key as `raw === true`, so an action key holding "false", 0 or null showed OFF while the Worker still
// allowed the action, and the next save wrote false: access silently removed. This file pins, over every stored value x key class x placement:
//
//   A. the editor's displayed state (frontend/src/utils/permissions.ts normalizePermissionState) equals the Worker's decision
//      (getPermissionTier / getActionTier / isActionBlocked), for the role alone, the user alone and every role + user pair;
//   B. normalising never changes what the Worker decides (the write-time normaliser, normalizePermissionMap, and the editor's state are both
//      access-neutral: saving a role cannot widen or narrow anything);
//   C. the REAL role and user save routes (POST/PUT /roles, POST/PUT /users) store real booleans (plus the two literal tiers), never a string,
//      null or number, and what they store grants exactly what the body grants today.
//
// Mutants this must kill: the editor reading `raw === true` again for action keys; a save route storing the body as sent.
//
// Run from the cloudflare directory: node scripts/test-permission-stored-value-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const CF = path.join(__dirname, '..')
const FE = path.join(CF, '..', 'frontend')

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
}
// Loads a TS file as CommonJS. Relative imports resolve to sibling .ts files (with or without the extension) unless overridden.
function loadTs(file, overrides = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const localRequire = (request) => {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      const withExt = /\.ts$/.test(request) ? request : `${request}.ts`
      return loadTs(path.resolve(path.dirname(file), withExt), overrides, cache)
    }
    return require(request)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', transpile(file))(mod.exports, localRequire, mod, file, path.dirname(file))
  return mod.exports
}

const worker = loadTs(path.join(CF, 'src', 'lib', 'permissions.ts'))
const editor = loadTs(path.join(FE, 'src', 'utils', 'permissions.ts'))
const editorActions = loadTs(path.join(FE, 'src', 'utils', 'permissionActions.ts'))

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

// Every value a stored permission could plausibly hold. ABSENT means the key is not in the JSON at all.
const ABSENT = Symbol('absent')
const STORED = [true, false, 'true', 'false', 'TRUE', 'review', 'view', 'full', null, 0, 1, -1, '', 'yes', [], {}, ABSENT]
const label = (v) => (v === ABSENT ? '<absent>' : JSON.stringify(v))

// Key classes. `section` keys are read by getPermissionTier; `action` keys by isActionBlocked on top of an allowed section.
const SECTIONS = ['pos', 'products', 'sales', 'inventory', 'audit_log', 'all']
const ACTIONS = [['products', 'delete'], ['inventory', 'adjust'], ['sales', 'customer'], ['contacts', 'view'], ['contacts', 'add'], ['contacts', 'edit']]

function mapOf(entries) {
  const out = {}
  for (const [key, value] of entries) if (value !== ABSENT) out[key] = value
  return out
}
// A Worker user: role permissions + the user's own, as the JSON strings the database holds.
function userOf(role, own) {
  return { role_code: 'staff', username: 'u', role_permissions: JSON.stringify(role), permissions: JSON.stringify(own) }
}
const tierOfEditorValue = (v) => (v === true ? 'full' : v === 'review' ? 'review' : v === 'view' ? 'view' : 'none')

// ---------------------------------------------------------------------------------------------------------------------------------------
// A. the editor's displayed state equals the Worker's decision
// ---------------------------------------------------------------------------------------------------------------------------------------
async function main() {
  await check('A1 section keys: the editor shows exactly the tier the Worker grants (role alone, user alone, every role + user pair)', () => {
    let n = 0
    for (const key of SECTIONS) {
      for (const roleValue of STORED) for (const ownValue of STORED) {
        const role = mapOf([[key, roleValue]])
        const own = mapOf([[key, ownValue]])
        const user = userOf(role, own)
        const merged = { ...role, ...own }
        const shown = editor.normalizePermissionState(merged)[key]
        // `all` is the master key: the Worker treats merged.all === true as administrator, which is not a tier.
        const workerTier = key === 'all' ? (worker.isAdminControlUser(user) ? 'full' : 'none') : worker.getPermissionTier(user, key)
        const shownTier = key in merged ? tierOfEditorValue(shown) : 'none'
        assert.equal(shownTier, workerTier, `${key}: role ${label(roleValue)} user ${label(ownValue)} shows ${label(shown)}, Worker says ${workerTier}`)
        // The frontend's own effective read (what the UI gates on) must agree as well.
        if (key !== 'all') assert.equal(editor.effectivePermissions(user).getPermissionTier(key), workerTier, `${key}: effectivePermissions disagrees with the Worker`)
        n += 1
      }
    }
    assert.ok(n > 1000, `matrix size ${n}`)
  })

  await check('A2 action keys: the editor shows OFF exactly when the Worker blocks the action (role alone, user alone, every pair)', () => {
    let n = 0
    let sawBlocked = false
    let sawAllowedJunk = false
    for (const [section, action] of ACTIONS) {
      const key = `${section}:${action}`
      for (const roleValue of STORED) for (const ownValue of STORED) {
        // The section itself is granted at Full so that only the action key decides; the contacts view rule also needs add/edit left alone.
        const role = { ...mapOf([[section, true], [key, roleValue]]) }
        const own = mapOf([[key, ownValue]])
        const user = userOf(role, own)
        const merged = { ...role, ...own }
        const state = editor.normalizePermissionState(merged)
        const editorOff = editorActions.isActionOverriddenOff(state, section, action)
        const workerBlocked = worker.isActionBlocked(user, section, action)
        assert.equal(editorOff, workerBlocked, `${key}: role ${label(roleValue)} user ${label(ownValue)} editor off=${editorOff}, Worker blocked=${workerBlocked}`)
        assert.equal(worker.getActionTier(user, section, action) === 'none', workerBlocked)
        // And the runtime button gate (effectivePermissions().can) is on the same side for a row with no extra requirements.
        if (section === 'products' && action === 'delete') {
          assert.equal(editor.effectivePermissions(user).can(section, action), !workerBlocked, `${key}: can() disagrees with the Worker`)
        }
        if (workerBlocked) sawBlocked = true
        if (!workerBlocked && ![true, ABSENT].includes(ownValue) && ownValue !== undefined && key in own) sawAllowedJunk = true
        n += 1
      }
    }
    assert.ok(sawBlocked, 'the matrix must contain blocked actions')
    assert.ok(sawAllowedJunk, 'the matrix must contain junk values the Worker allows (the case the old editor showed OFF)')
    assert.ok(n > 1500, `matrix size ${n}`)
  })

  await check('A3 the regression itself: an action stored "false", 0 or null is ON for the Worker and now ON in the editor', () => {
    for (const junk of ['false', 0, null, 'true', '', 'no']) {
      const user = userOf({ products: true, 'products:delete': junk }, {})
      assert.equal(worker.getActionTier(user, 'products', 'delete'), 'full', `Worker allows delete with ${label(junk)}`)
      const shown = editor.normalizePermissionState({ products: true, 'products:delete': junk })['products:delete']
      assert.equal(shown, true, `the editor must show ${label(junk)} as ON (it showed OFF, and the next save wrote false)`)
    }
    // ...and an explicit false is still OFF on both sides.
    const user = userOf({ products: true, 'products:delete': false }, {})
    assert.equal(worker.getActionTier(user, 'products', 'delete'), 'none')
    assert.equal(editor.normalizePermissionState({ products: true, 'products:delete': false })['products:delete'], false)
  })

  // -------------------------------------------------------------------------------------------------------------------------------------
  // B. normalising is access-neutral, on the Worker side and the editor side
  // -------------------------------------------------------------------------------------------------------------------------------------
  const decisions = (user) => ({
    tiers: SECTIONS.filter((k) => k !== 'all').map((k) => worker.getPermissionTier(user, k)),
    admin: worker.isAdminControlUser(user),
    actions: ACTIONS.map(([s, a]) => worker.getActionTier(user, s, a)),
    has: SECTIONS.map((k) => worker.hasPermission(user, k)),
  })
  await check('B the write-time normaliser and the editor state change no Worker decision, for every role + user pair', () => {
    const keys = [...SECTIONS, ...ACTIONS.map(([s, a]) => `${s}:${a}`)]
    let n = 0
    for (const key of keys) {
      const section = key.includes(':') ? key.split(':')[0] : null
      for (const roleValue of STORED) for (const ownValue of STORED) {
        const role = mapOf([...(section ? [[section, true]] : []), [key, roleValue]])
        const own = mapOf([[key, ownValue]])
        const before = decisions(userOf(role, own))
        const workerNormalised = decisions(userOf(worker.normalizePermissionMap(role), worker.normalizePermissionMap(own)))
        const editorNormalised = decisions(userOf(editor.normalizePermissionState(role), editor.normalizePermissionState(own)))
        assert.deepEqual(workerNormalised, before, `${key}: Worker normaliser changed access (role ${label(roleValue)}, user ${label(ownValue)})`)
        assert.deepEqual(editorNormalised, before, `${key}: editor state changed access (role ${label(roleValue)}, user ${label(ownValue)})`)
        n += 1
      }
    }
    assert.ok(n > 3000, `matrix size ${n}`)
  })

  await check('B2 the Worker normaliser and the editor state are the same function of every stored value, and idempotent', () => {
    for (const key of [...SECTIONS, ...ACTIONS.map(([s, a]) => `${s}:${a}`), 'Products', 'zzz_unknown', 'a:b:c']) {
      for (const value of STORED) {
        if (value === ABSENT) continue
        const fromWorker = worker.storedPermissionValue(key, value)
        const fromEditor = editor.storedPermissionValue(key, value)
        assert.equal(fromWorker, fromEditor, `${key}=${label(value)}: Worker ${label(fromWorker)} vs editor ${label(fromEditor)}`)
        assert.equal(worker.storedPermissionValue(key, fromWorker), fromWorker, `${key}=${label(value)} is not idempotent`)
        assert.ok(typeof fromWorker === 'boolean' || fromWorker === 'review' || fromWorker === 'view', 'only booleans and the two tiers are ever stored')
      }
    }
    // Section tiers are kept only where the key carries them.
    assert.equal(worker.storedPermissionValue('products', 'review'), 'review')
    assert.equal(worker.storedPermissionValue('pos', 'review'), false)
    assert.equal(worker.storedPermissionValue('sales', 'view'), 'view')
    assert.equal(worker.storedPermissionValue('products', 'view'), false)
    // The whole-object forms.
    for (const bad of [null, undefined, 'str', 5, [], [1, 2], true]) assert.deepEqual(worker.normalizePermissionMap(bad), {}, `non-object ${label(bad)} stores {}`)
    assert.deepEqual(worker.normalizePermissionMap({ a: 'true', b: 1, 'c:d': 'false', 'e:f': false, products: 'review' }), { a: false, b: false, 'c:d': true, 'e:f': false, products: 'review' })
  })

  // -------------------------------------------------------------------------------------------------------------------------------------
  // C. the real save routes store booleans
  // -------------------------------------------------------------------------------------------------------------------------------------
  const { openDb } = require('./harness/d1compat.cjs')
  const { loadAll } = require('./harness/load_migrations.cjs')
  const db = openDb(loadAll())
  const raw = db.db
  const ACTOR = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
  // The migrations do not seed roles or users (the Worker does at first boot): one administrator holding the admin role, and a plain staff role.
  raw.prepare("INSERT INTO roles (name, code, is_system, permissions) VALUES ('Admin', 'admin', 1, '{\"all\":true}')").run()
  raw.prepare("INSERT INTO roles (name, code, is_system, permissions) VALUES ('Staff', NULL, 0, '{}')").run()
  const adminRoleId = raw.prepare("SELECT id FROM roles WHERE code = 'admin'").get().id
  raw.prepare("INSERT INTO users (id, username, name, password, permissions, role_id, is_active) VALUES (1, 'admin', 'Admin', 'x', '{}', ?, 1)").run(adminRoleId)
  const adminRole = { id: raw.prepare("SELECT id FROM roles WHERE name = 'Staff'").get().id }
  const noopAsync = async () => {}
  const cache = new Map()
  const overrides = {
    '../index': {},
    '../lib/db': { getDb: () => db },
    '../lib/imageAudit': { enqueueImageNormalization: noopAsync },
    '../lib/passwordHash': { currentPasswordHashPrefix: () => '', describePasswordHash: () => ({}), hashPassword: async () => 'hash', isCurrentPasswordHash: () => true, passwordPepperStatus: () => ({}), PASSWORD_HASH_ALGORITHM: 'x', PASSWORD_HASH_ITERATIONS: 1 },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', ACTOR); return next() }, revokeUserSessions: noopAsync },
    '../durable-objects/broadcastHub': { broadcast: noopAsync },
    '../lib/cache': { bumpVersions: noopAsync, bumpVersion: noopAsync },
    '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1' },
    '../lib/currentPasswordGuard': { CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'x', verifyCurrentPassword: async () => ({ ok: true }) },
    '../lib/passwordPolicy': { newPasswordProblem: () => null, newPasswordProblemError: () => '', passwordKnownLeaked: async () => false, setPasswordMustChange: noopAsync, KNOWN_LEAKED_PASSWORD_CODE: 'x', KNOWN_LEAKED_PASSWORD_ERROR: 'x' },
    '../lib/googleOauth': { isGoogleLinkReady: () => false },
    '../lib/uploadSecurity': { isPublicImageFormat: () => true, UNSUPPORTED_IMAGE_MESSAGE: '', validateUploadedBuffer: () => ({ ok: true }) },
    '../lib/fileAssets': { getMediaType: () => 'image', buildUniqueStoredName: (n) => n, sanitizeOriginalFileName: (n) => n },
    '../lib/audit': { audit: noopAsync, changedFields: () => [], auditChangeColumns: () => ({ old_value: null, new_value: null }), requestDeviceColumnSql: (_u, _c, fallback) => fallback, requestDeviceParams: () => ({}) },
  }
  const usersRoute = loadTs(path.join(CF, 'src', 'routes', 'users.ts'), overrides, cache)
  const app = usersRoute.default
  const ctx = { waitUntil: (p) => { if (p && p.catch) p.catch(() => {}) }, passThroughOnException: () => {} }
  const env = { DB: db, CACHE: { get: async () => null, put: async () => {} } }
  async function call(method, url, body) {
    const res = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx)
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  // A body of the nastiest mixed shape: junk where a boolean belongs, on section and action keys, plus legitimate tiers.
  const JUNK_BODY = {
    pos: true, products: 'review', sales: 'view', inventory: 'true', audit_log: 1, settings: null, contacts: 'review', reports: 'false',
    'products:delete': 'false', 'products:add': 0, 'products:edit': null, 'products:export': 'true', 'inventory:adjust': false, 'contacts:add': '',
    all: 'true', 'pos:refund': 'review', fees: 'view',
  }
  const expected = worker.normalizePermissionMap(JUNK_BODY)
  const sameAccess = (stored) => {
    const a = decisions(userOf(stored, {}))
    const b = decisions(userOf(JUNK_BODY, {}))
    assert.deepEqual(a, b, 'the stored map must grant exactly what the body granted')
  }
  const assertReal = (stored) => {
    assert.deepEqual(stored, expected, 'stored map is the normalised body')
    for (const [key, value] of Object.entries(stored)) {
      assert.ok(typeof value === 'boolean' || value === 'review' || value === 'view', `${key} stored as ${label(value)}`)
    }
    assert.ok(!Object.values(stored).some((v) => typeof v === 'string' && v !== 'review' && v !== 'view'), 'no "true" / "false" strings')
    sameAccess(stored)
  }
  const storedRole = (id) => JSON.parse(raw.prepare('SELECT permissions FROM roles WHERE id = ?').get(id).permissions)
  const storedUser = (id) => JSON.parse(raw.prepare('SELECT permissions FROM users WHERE id = ?').get(id).permissions)

  let roleId = 0
  await check('C1 POST /roles stores real booleans', async () => {
    const res = await call('POST', '/roles', { name: 'Parity role', permissions: JUNK_BODY })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    roleId = raw.prepare("SELECT id FROM roles WHERE name = 'Parity role'").get().id
    assertReal(storedRole(roleId))
  })

  await check('C2 PUT /roles/:id stores real booleans, and a re-save of the same body is a no-op', async () => {
    const updatedAt = raw.prepare('SELECT updated_at FROM roles WHERE id = ?').get(roleId).updated_at
    // First make the stored row differ so the PUT writes: save a plain map, then the junk body over it.
    let res = await call('PUT', `/roles/${roleId}`, { name: 'Parity role', permissions: { pos: true }, expected_updated_at: updatedAt })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(storedRole(roleId), { pos: true })
    const next = raw.prepare('SELECT updated_at FROM roles WHERE id = ?').get(roleId).updated_at
    res = await call('PUT', `/roles/${roleId}`, { name: 'Parity role', permissions: JUNK_BODY, expected_updated_at: next })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assertReal(storedRole(roleId))
    const after = raw.prepare('SELECT updated_at FROM roles WHERE id = ?').get(roleId).updated_at
    res = await call('PUT', `/roles/${roleId}`, { name: 'Parity role', permissions: JUNK_BODY, expected_updated_at: after })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.unchanged, true, 'saving the same grants again changes nothing')
  })

  await check('C3 a non-object permissions body stores {} (as before), never a string', async () => {
    for (const bad of ['{"pos":true}', 7, [1], null]) {
      const res = await call('POST', '/roles', { name: `Bad ${JSON.stringify(bad)}`, permissions: bad })
      assert.equal(res.status, 200, JSON.stringify(res.json))
      assert.deepEqual(storedRole(raw.prepare('SELECT id FROM roles WHERE name = ?').get(`Bad ${JSON.stringify(bad)}`).id), {})
    }
  })

  let userId = 0
  await check('C4 POST /users stores real booleans', async () => {
    const res = await call('POST', '/users', { username: 'parityuser', password: 'a-long-enough-pass-1', name: 'Parity', role_id: adminRole.id, permissions: JUNK_BODY })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    userId = raw.prepare("SELECT id FROM users WHERE username = 'parityuser'").get().id
    assertReal(storedUser(userId))
  })

  await check('C5 PUT /users/:id stores real booleans, and leaves stored permissions alone when the body has none', async () => {
    raw.prepare('UPDATE users SET permissions = ? WHERE id = ?').run('{"products:delete":"false"}', userId)
    const row = raw.prepare('SELECT updated_at FROM users WHERE id = ?').get(userId)
    let res = await call('PUT', `/users/${userId}`, { username: 'parityuser', name: 'Parity', role_id: adminRole.id, expected_updated_at: row.updated_at })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(storedUser(userId), { 'products:delete': 'false' }, 'no permissions in the body: stored map untouched')
    const next = raw.prepare('SELECT updated_at FROM users WHERE id = ?').get(userId)
    res = await call('PUT', `/users/${userId}`, { username: 'parityuser', name: 'Parity', role_id: adminRole.id, permissions: JUNK_BODY, expected_updated_at: next.updated_at })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assertReal(storedUser(userId))
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
  console.log('All stored-permission parity checks passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
