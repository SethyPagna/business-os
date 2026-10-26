// 6.0.993 (RC1 review P3-1, P3-5): the rotating cron's state rows and the
// retention sweeps' last-run stamps are SYSTEM-OWNED settings rows.
//   - GET /api/settings never returns them (they carry up to 200 characters of
//     step error text), to a cashier or to a Settings account alike;
//   - POST /api/settings refuses them for everyone, administrators included;
//   - the cron code still reads and writes them directly (lib/cronRotationStore)
//     and /api/runtime/cron-health still reads them;
//   - a /cron-health failure answers with a generic message, the detail goes
//     to the log.
//
// Drives the REAL routes/settings.ts, routes/runtime.ts and lib/cronRotationStore.ts.
//
// Run: node scripts/test-settings-system-owned-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

const db = openDb(loadAll())
let sessionUser = null
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  // lib/db.ts adapter shape for the cron store: run() answers { changes }.
  './db': { getDb: (env) => ({ prepare: (sql) => { const stmt = env.DB.prepare(sql); return { get: async (p) => stmt.get(p), all: async (p) => stmt.all(p) || [], run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0 } } } } }) },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': { changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false, audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}
const cache = new Map()
function load(rel, extra = {}) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(extra, request)) return extra[request]
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const settingsApp = load('routes/settings.ts').default
const ADMIN = { id: 12, username: 'owner', permissions: JSON.stringify({ all: true }), role_code: null, role_permissions: null }
const MANAGER = { id: 11, username: 'manager', permissions: JSON.stringify({ settings: true }), role_code: null, role_permissions: null }
const CASHIER = { id: 13, username: 'till', permissions: JSON.stringify({ pos: true }), role_code: null, role_permissions: null }
const ctx = { waitUntil() {}, passThroughOnException() {} }

async function call(user, method, url, body) {
  sessionUser = user
  const res = await settingsApp.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, { DB: db }, ctx)
  return { status: res.status, body: await res.json() }
}
const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
function seed(key, value) { db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value }) }

const SYSTEM_KEYS = ['cron_rotation_state', 'cron_heavy_state', 'audit_log_retention_last_run', 'import_retention_last_run', 'ephemeral_retention_last_run', 'ephemeral_retention_last_run:auth']
const LEAK = 'step failed: secret-looking detail'

async function main() {
  for (const key of SYSTEM_KEYS) seed(key, JSON.stringify({ error: LEAK }))
  seed('business_name', 'Leang Beauty')

  await check('GET /api/settings withholds every system-owned row from cashier, Settings account and administrator', async () => {
    for (const user of [CASHIER, MANAGER, ADMIN]) {
      const res = await call(user, 'GET', '/')
      assert.equal(res.status, 200)
      for (const key of SYSTEM_KEYS) assert.ok(!(key in res.body), `${user.username} must not receive ${key}`)
      assert.ok(!JSON.stringify(res.body).includes(LEAK))
      assert.equal(res.body.business_name, 'Leang Beauty', 'ordinary keys still flow')
    }
  })

  await check('POST /api/settings refuses system-owned rows for everyone, including aliases', async () => {
    for (const user of [MANAGER, ADMIN]) {
      for (const key of [...SYSTEM_KEYS, 'Cron_Rotation_State', ' cron_heavy_state ']) {
        const before = stored(key.trim().toLowerCase())
        const res = await call(user, 'POST', '/', { [key]: '{"cursor":0}' })
        assert.equal(res.status, 403, `${user.username} writing ${JSON.stringify(key)}`)
        assert.equal(res.body.code, 'system_owned_setting')
        assert.equal(stored(key.trim().toLowerCase()), before, `${key} unchanged`)
      }
    }
  })

  await check('one system-owned key refuses the whole save (no silent partial write)', async () => {
    const res = await call(ADMIN, 'POST', '/', { business_name: 'Changed', cron_rotation_state: '{}' })
    assert.equal(res.status, 403)
    assert.equal(stored('business_name'), 'Leang Beauty')
  })

  await check('CONTROL: ordinary keys still save, and a lookalike key is not caught', async () => {
    const res = await call(ADMIN, 'POST', '/', { business_name: 'Leang Cosmetics', last_run_notes: 'x' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored('business_name'), 'Leang Cosmetics')
    assert.equal(stored('last_run_notes'), 'x')
  })

  await check('the cron store still reads and writes its rows directly', async () => {
    const { settingsRotationStore } = load('lib/cronRotationStore.ts')
    const { CRON_STATE_KEY } = load('lib/cronRotation.ts')
    const store = settingsRotationStore({ DB: db }, CRON_STATE_KEY)
    const loaded = await store.load()
    assert.ok(loaded, 'seeded row loads')
    const next = { ...loaded, cursor: 4, version: loaded.version + 1 }
    const r1 = await store.save(next, loaded.version); assert.equal(r1, true, "update save returned " + r1 + " v=" + loaded.version + " raw=" + stored(CRON_STATE_KEY))
    assert.equal(JSON.parse(stored(CRON_STATE_KEY)).cursor, 4)
    const freshStore = settingsRotationStore({ DB: db }, 'cron_heavy_state_new')
    const r2 = await freshStore.save({ ...loaded, version: 1 }, null); assert.equal(r2, true, 'first-ever insert returned ' + r2)
  })

  function runtimeApp(getDbImpl, hasPermissionImpl = () => true) {
    const mod = { exports: {} }
    const sourcePath = path.join(__dirname, '..', 'src', 'routes', 'runtime.ts')
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
    }).outputText
    const cron = load('lib/cronRotation.ts')
    const ids = load('lib/cronStepIds.ts')
    const stubs = {
      '../lib/db': { getDb: getDbImpl },
      '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
      '../lib/permissions': { hasPermission: hasPermissionImpl },
      '../lib/catalogText': { hasSuspiciousCatalogText: () => false },
      '../lib/buildStamp': { getBuildStamp: () => ({ builtAt: new Date(0).toISOString() }) },
      '../lib/planTier': { getPlanLimits: () => ({}), resolvePlanTier: () => 'paid' },
      '../lib/cronRotation': cron,
      '../lib/cronStepIds': ids,
    }
    new Function('require', 'module', 'exports', output)((r) => (r in stubs ? stubs[r] : require(r)), mod, mod.exports)
    return mod.exports.default
  }

  await check('/cron-health still answers 200 from the system-owned rows', async () => {
    sessionUser = ADMIN
    const app = runtimeApp((env) => env.DB)
    const res = await app.request('/cron-health', {}, { DB: db })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.success, true)
    assert.ok(Array.isArray(body.steps))
  })

  await check('/cron-health 500 is generic and the detail goes to the log', async () => {
    sessionUser = ADMIN
    const secret = 'D1_ERROR: no such table: internal_secret_table_name'
    const app = runtimeApp(() => ({ prepare: () => { throw new Error(secret) } }))
    const logged = []
    const original = console.error
    console.error = (...args) => { logged.push(args.join(' ')) }
    let res
    try { res = await app.request('/cron-health', {}, {}) } finally { console.error = original }
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.ok(!text.includes('internal_secret_table_name'), `response leaked: ${text}`)
    assert.ok(logged.some((line) => line.includes('internal_secret_table_name')), 'the detail is logged')
  })

  await check('a cron row write between load and save does not cause a false conflict (RC1 regression)', async () => {
    db.prepare("DELETE FROM settings WHERE key = 'last_run_notes'").run()
    db.prepare("UPDATE settings SET updated_at = '2026-01-01 00:00:00' WHERE key NOT IN ('cron_rotation_state','cron_heavy_state') AND key NOT LIKE '%last_run%'").run()
    db.prepare("UPDATE settings SET updated_at = '2026-01-02 00:00:00' WHERE key IN ('cron_rotation_state','cron_heavy_state') OR key LIKE '%last_run%'").run()
    // The Settings screen asks for the version of the keys it is about to write; none exist yet, so
    // the answer is the table-wide stamp.
    const meta = await call(MANAGER, 'GET', '/meta?keys=brand_new_key')
    assert.equal(meta.status, 200)
    assert.equal(meta.body.updatedAt, '2026-01-01 00:00:00', 'the stamp ignores the cron rows')
    // The cron ticks (direct write, as cronRotationStore does) before the save lands.
    db.prepare("UPDATE settings SET updated_at = '2026-01-03 00:00:00', value = '{\"version\":9}' WHERE key = 'cron_rotation_state'").run()
    db.prepare("UPDATE settings SET updated_at = '2026-01-03 00:00:00' WHERE key = 'audit_log_retention_last_run'").run()
    const saved = await call(MANAGER, 'POST', '/', { brand_new_key: 'v', expectedUpdatedAt: meta.body.updatedAt })
    assert.equal(saved.status, 200, 'false 409: ' + JSON.stringify(saved.body))
    assert.equal(stored('brand_new_key'), 'v')
  })

  await check('CONTROL: a real user edit of another row between load and save is still a conflict', async () => {
    db.prepare("UPDATE settings SET updated_at = '2026-01-01 00:00:00' WHERE key = 'business_name'").run()
    const meta = await call(MANAGER, 'GET', '/meta?keys=another_new_key')
    db.prepare("UPDATE settings SET updated_at = '2099-02-01 00:00:00' WHERE key = 'business_name'").run()
    const res = await call(MANAGER, 'POST', '/', { another_new_key: 'v', expectedUpdatedAt: meta.body.updatedAt })
    assert.equal(res.status, 409, JSON.stringify(res.body))
  })

  await check('GET /api/settings updatedAt never carries a cron stamp', async () => {
    db.prepare("UPDATE settings SET updated_at = '2099-01-01 00:00:00' WHERE key = 'cron_heavy_state'").run()
    const res = await call(MANAGER, 'GET', '/')
    assert.notEqual(res.body.updatedAt, '2099-01-01 00:00:00')
  })

  await check('the SQL exclusion and isSystemOwnedSettingKey agree', async () => {
    const sens = load('lib/settingsSensitive.ts')
    for (const key of [...SYSTEM_KEYS, 'CRON_ROTATION_STATE', 'x_last_run', 'x_last_run:grp', 'business_name', 'last_run_notes', 'lastrun', 'a_last_runner', 'telegram_chat_id']) {
      const sqlSaysUser = !!db.prepare('SELECT 1 AS ok FROM (SELECT ? AS key) WHERE ' + sens.NOT_SYSTEM_OWNED_SETTING_SQL).get([key])
      assert.equal(sqlSaysUser, !sens.isSystemOwnedSettingKey(key), key)
    }
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-settings-system-owned-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-settings-system-owned-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
