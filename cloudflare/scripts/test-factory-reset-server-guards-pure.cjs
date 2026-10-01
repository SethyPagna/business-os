// FX-sec item 1 (security hunt H-sec): POST /api/system/factory-reset wiped
// every table, user and uploaded file for any account holding
// 'backup_restore', with NO body at all. The typed "FACTORY RESET" phrase
// lived only in the browser (ResetData.tsx), the route never asked for the
// caller's password, took no backup first (unlike every reset-data mode),
// and answered with the reseeded admin password in its JSON.
//
// Drives the REAL routes/system.ts POST /factory-reset over in-memory SQLite
// with the REAL lib/permissions.ts, and pins that the wipe runs only when ALL
// of these hold, in this order, and that each refusal changes nothing:
//   - administrator control (isAdminControlUser), not merely backup_restore;
//   - body.confirm === 'FACTORY RESET' (exact, case-sensitive);
//   - the caller's current password (lib/currentPasswordGuard.ts);
//   - a seed admin password is configured (otherwise the wipe would leave
//     nobody able to sign in);
//   - a full backup completed first.
// And the response never carries the seed password.
//
// Run: node scripts/test-factory-reset-server-guards-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')


const stockDependencyCache = new Map()
function loadStockDependency(relPath) {
  if (stockDependencyCache.has(relPath)) return stockDependencyCache.get(relPath).exports
  if (!['lib/stockLifecycle.ts', 'lib/db.ts', 'lib/importMaintenanceFence.ts'].includes(relPath)) {
    throw new Error('Unexpected stock dependency: ' + relPath)
  }
  const file = path.join(__dirname, '..', 'src', relPath)
  const loaded = { exports: {} }
  stockDependencyCache.set(relPath, loaded)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText
  const localRequire = (request) => {
    if (request === 'hono/http-exception') return require(request)
    if (!request.startsWith('.')) throw new Error('Unexpected stock external: ' + request)
    const next = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), request))
    return loadStockDependency(next.endsWith('.ts') ? next : next + '.ts')
  }
  try { new Function('exports', 'require', 'module', code)(loaded.exports, localRequire, loaded) }
  catch (error) { stockDependencyCache.delete(relPath); throw error }
  return loaded.exports
}

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  // Kept installed for the module's lifetime: the route loads some helpers
  // lazily with await import(), which transpiles to a deferred require().
  const patched = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (request === '../lib/stockLifecycle' || request === './stockLifecycle') return loadStockDependency('lib/stockLifecycle.ts')
    return originalLoad.call(this, request, parent, isMain)
  }
  const mod = { exports: {} }
  const localRequire = (request) => patched.call(Module, request, module, false)
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    mod.exports, localRequire, mod, sourcePath, path.dirname(sourcePath),
  )
  return mod.exports
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, deleted_at TEXT);
  CREATE TABLE sales (id INTEGER PRIMARY KEY, total REAL);
  CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  CREATE TABLE import_job_rows (id INTEGER PRIMARY KEY);
  CREATE TABLE import_job_source_rows (id INTEGER PRIMARY KEY);
`

let db
let log
let backupFails
let seedPassword
let cache
let actor
let passwordLimited

const SEED_SECRET = 'seed-secret-Zq81'
const ADMIN = { id: 1, username: 'owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
// Holds backup_restore (the old gate) but is not an administrator.
const RESTORER = { id: 2, username: 'restorer', role_code: 'manager', permissions: JSON.stringify({ backup: true, backup_restore: true }), role_permissions: '{}' }
// Named "admin" with no admin role and no `all` grant (item 2's reserved name).
const NAMED_ADMIN = { id: 3, username: 'admin', role_code: 'employee', permissions: JSON.stringify({ backup_restore: true }), role_permissions: '{}' }

const permissions = loadReal('lib/permissions.ts')

const app = loadReal('routes/system.ts', {
  hono: require('hono'),
  '../lib/planTier': loadReal('lib/planTier.ts'),
  '../lib/actorSnapshot': { actorSnapshot: (u) => u?.username || null },
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() } },
  '../lib/audit': { audit: async (...args) => { log.push(`audit:${args[3]}`) } },
  '../lib/permissions': permissions,
  '../lib/dataIntegrity': { runDataIntegrityCheck: async () => ({}) },
  '../lib/errorReporting': { reportError: async () => false },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }), getClientIp: () => '127.0.0.1' },
  '../lib/r2': {
    listObjects: async (_bucket, prefix) => { log.push(`r2-list:${prefix}`); return [] },
    deleteObject: async () => {},
    deleteObjectsBulk: async (_bucket, keys) => ({ deleted: keys.length, errors: [] }),
  },
  '../lib/importRetention': { cleanOrphanImportStaging: async () => ({}) },
  '../lib/media': { sanitizeMediaList: (v) => v },
  '../lib/coreDataInvariants': {
    FACTORY_RESET_TABLES: ['sales'],
    PRODUCTS_RESET_TABLES: [],
    presentResetTables: async (_db, tables) => tables,
    dropAllCustomTables: async () => { log.push('drop-custom'); return [] },
    ensureCoreDataInvariants: async () => { log.push('reseed'); return { adminUserCreated: true, adminPassword: seedPassword } },
    resolveSeedAdminPassword: () => seedPassword,
  },
  '../lib/backup': {
    createCloudflareBackup: async () => { log.push('backup'); if (backupFails) throw new Error('simulated backup failure'); return { name: 'b' } },
    createSectionBackup: async () => { log.push('section-backup'); return { name: 's' } },
  },
  '../lib/currentPasswordGuard': {
    CURRENT_PASSWORD_RATE_LIMITED_ERROR: 'Too many wrong current-password attempts. Please try again later.',
    verifyCurrentPassword: async (_c, who, plain, hash) => {
      log.push(`verify:${who.actorId}->${who.targetId}`)
      if (passwordLimited) return { ok: false, rateLimited: true, retryAfterSeconds: 60 }
      return hash === `hash:${plain}` ? { ok: true } : { ok: false, rateLimited: false }
    },
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
}).default

const ctx = { waitUntil(p) { p?.catch?.(() => {}) }, passThroughOnException() {} }

function reset() {
  db = openDb([SCHEMA])
  db.prepare(`INSERT INTO users(id, username, password) VALUES (1,'owner','hash:owner-pw'), (2,'restorer','hash:restorer-pw'), (3,'admin','hash:named-pw')`).run()
  db.prepare(`INSERT INTO sales(id, total) VALUES (1, 10), (2, 20)`).run()
  log = []
  backupFails = false
  seedPassword = SEED_SECRET
  passwordLimited = false
  cache = new Map()
  actor = ADMIN
}

const env = () => ({
  DB: db,
  ASSETS: {},
  CACHE: { get: async (k) => cache.get(k) ?? null, put: async (k, v) => { cache.set(k, v) } },
})

async function post(body) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await app.request('/factory-reset', init, env(), ctx)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* keep raw */ }
  return { status: res.status, json, text }
}

const salesLeft = () => db.prepare('SELECT COUNT(*) AS n FROM sales').get().n
const wiped = () => log.includes('drop-custom') || log.includes('reseed') || salesLeft() !== 2
const GOOD = { confirm: 'FACTORY RESET', currentPassword: 'owner-pw' }

let failures = 0
async function check(name, fn) {
  try { reset(); await fn(); console.log(`ok - ${name}`) } catch (error) { failures += 1; console.error(`not ok - ${name}\n${error.stack || error}`) }
}

;(async () => {
  await check('backup_restore without administrator control is refused and nothing is touched', async () => {
    actor = RESTORER
    const res = await post({ confirm: 'FACTORY RESET', currentPassword: 'restorer-pw' })
    assert.equal(res.status, 403, res.text)
    assert.equal(wiped(), false, 'no wipe')
    assert.equal(log.includes('backup'), false, 'no backup either')
  })

  await check('a user merely NAMED admin (no admin role, no all grant) is not an administrator here', async () => {
    actor = NAMED_ADMIN
    const res = await post({ confirm: 'FACTORY RESET', currentPassword: 'named-pw' })
    assert.equal(res.status, 403, res.text)
    assert.equal(wiped(), false)
  })

  await check('an administrator with NO body is refused (the phrase is enforced server-side)', async () => {
    const res = await post(undefined)
    assert.equal(res.status, 400, res.text)
    assert.equal(res.json?.code, 'factory_reset_confirm_required')
    assert.equal(wiped(), false)
    assert.equal(log.includes('backup'), false)
  })

  await check('a wrong or near-miss phrase is refused', async () => {
    for (const confirm of ['factory reset', 'FACTORY  RESET', ' FACTORY RESET', 'FACTORY RESET ', true, 1, null]) {
      reset()
      const res = await post({ confirm, currentPassword: 'owner-pw' })
      assert.equal(res.status, 400, `${JSON.stringify(confirm)} -> ${res.text}`)
      assert.equal(res.json?.code, 'factory_reset_confirm_required')
      assert.equal(wiped(), false, JSON.stringify(confirm))
    }
  })

  await check('the phrase without the current password is refused', async () => {
    const res = await post({ confirm: 'FACTORY RESET' })
    assert.equal(res.status, 400, res.text)
    assert.equal(res.json?.code, 'current_password_required')
    assert.equal(wiped(), false)
  })

  await check('a wrong current password is refused with 400 (never 401) and nothing is touched', async () => {
    const res = await post({ confirm: 'FACTORY RESET', currentPassword: 'guess' })
    assert.equal(res.status, 400, res.text)
    assert.equal(res.json?.code, 'incorrect_password')
    assert.ok(log.includes('verify:1->1'), 'the check runs through the shared current-password guard, on the caller')
    assert.equal(wiped(), false)
    assert.equal(log.includes('backup'), false)
  })

  await check('a rate-limited password check answers 429 and nothing is touched', async () => {
    passwordLimited = true
    const res = await post(GOOD)
    assert.equal(res.status, 429, res.text)
    assert.equal(wiped(), false)
  })

  await check('with no seed admin password configured the wipe is refused (it would lock everyone out)', async () => {
    seedPassword = null
    const res = await post(GOOD)
    assert.equal(res.status, 409, res.text)
    assert.equal(res.json?.code, 'factory_reset_seed_unavailable')
    assert.equal(wiped(), false)
    assert.equal(log.includes('backup'), false)
  })

  await check('a failed backup aborts before any delete', async () => {
    backupFails = true
    const res = await post(GOOD)
    assert.equal(res.status, 500, res.text)
    assert.match(String(res.json?.error || ''), /backup/i)
    assert.equal(wiped(), false)
  })

  await check('all four conditions met: backup first, then the wipe; no password in the response', async () => {
    const res = await post(GOOD)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.json?.success, true)
    assert.equal(salesLeft(), 0, 'the wipe ran')
    const backupAt = log.indexOf('backup')
    assert.ok(backupAt > -1, 'a full backup was taken')
    assert.ok(backupAt < log.indexOf('drop-custom'), `backup precedes the first destructive step: ${log.join(',')}`)
    assert.ok(backupAt < log.indexOf('reseed'))
    assert.equal(res.text.includes(SEED_SECRET), false, 'the seed admin password never leaves the Worker')
    assert.equal(res.json?.admin?.password ?? null, null)
  })

  if (failures) { console.error(`${failures} failing`); process.exit(1) }
  console.log('all ok')
})()
